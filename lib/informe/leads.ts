/**
 * Lead capture for the ISO Survey report.
 *
 * Two doors lead here: an Instagram DM that answers a campaign with an email in
 * it, and the public web form. Both end the same way: a Lead row with a private
 * token, and the report email whose "View report" button opens
 * /informe/<token>.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { sendDirectMessage } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { DEFAULT_COUNTRY, countryByA2, findCountry, findEmail, stripEmails, type Locale } from "./datos";
import { buildReportEmail, sendReportEmail } from "./email";

export const reportUrl = (token: string) => `${getBaseUrl()}/informe/${token}`;
export const unsubscribeUrl = (token: string) => `${getBaseUrl()}/informe/baja/${token}`;

export function newToken(): string {
  return randomBytes(18).toString("base64url");
}

export function asLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "es";
}

/** Sends (or re-sends) the report email for a lead and records the outcome. */
export async function deliverReport(leadId: string): Promise<{ ok: boolean; error?: string }> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const locale = asLocale(lead.locale);
  const email = buildReportEmail({
    countryA2: lead.countryA2,
    locale,
    reportUrl: reportUrl(lead.token),
    unsubscribeUrl: unsubscribeUrl(lead.token),
  });
  try {
    await sendReportEmail(lead.email, email, unsubscribeUrl(lead.token));
    await prisma.lead.update({ where: { id: lead.id }, data: { emailSentAt: new Date(), emailError: null } });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.lead.update({ where: { id: lead.id }, data: { emailError: message.slice(0, 500) } });
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------- Instagram DM door

const CONFIRM = {
  es: {
    ok: (country: string, email: string, guessed: boolean) =>
      `¡Gracias! Te mandamos el informe ISO Survey 2025 de ${country} a ${email}.\n\n` +
      `Si no lo ves en unos minutos, revisa promociones o correo no deseado.` +
      (guessed ? `\n\nNo encontramos tu país en el mensaje, así que va el de ${country}. Dentro del informe puedes cambiarlo por el tuyo.` : ""),
    failed: (email: string) =>
      `No pudimos enviar el informe a ${email}. ¿Puedes revisar el correo y mandárnoslo de nuevo?`,
  },
  en: {
    ok: (country: string, email: string, guessed: boolean) =>
      `Thanks! We sent the ISO Survey 2025 report for ${country} to ${email}.\n\n` +
      `If you don't see it in a few minutes, check your promotions or spam folder.` +
      (guessed ? `\n\nWe couldn't find your country in your message, so it's the one for ${country}. You can switch to yours inside the report.` : ""),
    failed: (email: string) =>
      `We couldn't send the report to ${email}. Could you check the address and send it again?`,
  },
} as const;

export interface InboundMessage {
  instagramAccountId: string; // the professional account's Instagram id
  messageId: string;
  messageText: string;
  senderId: string;
}

/**
 * If the DM carries an email and the account runs a lead-capture campaign,
 * save the lead, email the report and confirm in the chat. Returns true when
 * the message was handled here. Idempotent per message id, so a webhook retry
 * never sends a second email.
 */
export async function captureLeadFromMessage(message: InboundMessage): Promise<boolean> {
  const email = findEmail(message.messageText);
  if (!email) return false;

  const automation = await prisma.automation.findFirst({
    where: {
      collectEmail: true,
      isActive: true,
      instagramAccount: { instagramId: message.instagramAccountId },
    },
    include: { instagramAccount: true },
    orderBy: { createdAt: "asc" },
  });
  if (!automation) return false;

  const already = await prisma.lead.findUnique({ where: { messageId: message.messageId } });
  if (already) return true;

  const locale = asLocale(automation.leadLocale);
  // The email's own domain (".mx") must not be read as a country.
  const rest = stripEmails(message.messageText);
  const found = findCountry(rest);
  const countryA2 = found ?? DEFAULT_COUNTRY[locale];

  // The messages webhook carries only the sender id; reuse the name we saw on
  // the comment that started the conversation, if any.
  const prior = await prisma.dmLog.findFirst({
    where: { commenterId: message.senderId, instagramAccountId: automation.instagramAccountId },
    orderBy: { createdAt: "desc" },
    select: { commenterName: true, automationId: true },
  });

  const lead = await prisma.lead.create({
    data: {
      workspaceId: automation.workspaceId,
      instagramAccountId: automation.instagramAccountId,
      automationId: prior?.automationId ?? automation.id,
      source: "INSTAGRAM_DM",
      igUserId: message.senderId,
      igUsername: prior?.commenterName ?? null,
      email,
      countryA2,
      countryRaw: rest.trim().slice(0, 200) || null,
      locale,
      token: newToken(),
      messageId: message.messageId,
    },
  });

  const result = await deliverReport(lead.id);

  if (automation.instagramAccount.accessToken) {
    try {
      const accessToken = decryptToken(automation.instagramAccount.accessToken);
      const country = countryByA2(countryA2);
      const name = country ? (locale === "es" ? country.es : country.en) : countryA2;
      const text = result.ok ? CONFIRM[locale].ok(name, email, !found) : CONFIRM[locale].failed(email);
      await sendDirectMessage(accessToken, automation.instagramAccount.instagramId, message.senderId, text);
      if (result.ok) await prisma.lead.update({ where: { id: lead.id }, data: { dmConfirmedAt: new Date() } });
    } catch (error) {
      console.error("[Leads] Could not confirm in the chat:", error instanceof Error ? error.message : error);
    }
  }
  return true;
}

// ---------------------------------------------------------------- web form door

export interface WebRequest {
  email: string;
  countryA2: string | null;
  locale: Locale;
  newsletterOptIn: boolean;
  ipHash: string | null;
}

/** Creates the lead from the public form and sends the report. */
export async function captureLeadFromWeb(req: WebRequest): Promise<{ ok: boolean; error?: string }> {
  // The campaign for this language owns web leads too; fall back to any
  // lead-capture campaign so a form submission never lands nowhere.
  const automation =
    (await prisma.automation.findFirst({ where: { collectEmail: true, leadLocale: req.locale }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.automation.findFirst({ where: { collectEmail: true }, orderBy: { createdAt: "asc" } }));
  const workspace = automation
    ? { id: automation.workspaceId }
    : await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!workspace) return { ok: false, error: "No workspace" };

  // Same person, same country, within ten minutes: don't email twice.
  const recent = await prisma.lead.findFirst({
    where: {
      email: req.email,
      countryA2: req.countryA2,
      source: "WEB",
      createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
    },
  });
  if (recent) return { ok: true };

  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      instagramAccountId: automation?.instagramAccountId ?? null,
      automationId: automation?.id ?? null,
      source: "WEB",
      email: req.email,
      countryA2: countryByA2(req.countryA2)?.a2 ?? DEFAULT_COUNTRY[req.locale],
      locale: req.locale,
      newsletterOptIn: req.newsletterOptIn,
      token: newToken(),
      ipHash: req.ipHash,
    },
  });
  return deliverReport(lead.id);
}
