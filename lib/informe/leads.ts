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
import { getUserFollowStatus, sendDirectMessage, sendDirectMessageWithLinkButton } from "@/lib/meta/client";
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
      `¡Listo! 🎉 Tu informe ISO Survey 2025 ya va en camino a ${email}.\n\n` +
      (guessed
        ? `Te mandamos el de ${country}; dentro del informe puedes cambiarlo por cualquier país.\n\n`
        : `Es el de ${country}, y dentro puedes compararlo con cualquier otro país.\n\n`) +
      `Si no lo ves en unos minutos, échale un ojo a promociones o correo no deseado.`,
    failed: (email: string) =>
      `Uy, no pudimos enviarlo a ${email} 😕 ¿Nos compartes tu correo de nuevo?`,
    follow: "Gracias por leernos 💚 Cada semana compartimos datos y claves de certificación ISO. ¿Nos sigues para no perderte el siguiente?",
    followButton: "Seguir a FVR",
  },
  en: {
    ok: (country: string, email: string, guessed: boolean) =>
      `All set! 🎉 Your ISO Survey 2025 report is on its way to ${email}.\n\n` +
      (guessed
        ? `We sent the one for ${country}; inside the report you can switch to any country.\n\n`
        : `It's the one for ${country}, and inside you can compare it with any other country.\n\n`) +
      `If you don't see it in a few minutes, check your promotions or spam folder.`,
    failed: (email: string) =>
      `Oops, we couldn't send it to ${email} 😕 Could you share your email again?`,
    follow: "Thanks for reading 💚 Every week we share data and insights on ISO certification. Follow us so you don't miss the next one?",
    followButton: "Follow FVR",
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
      if (result.ok) {
        await prisma.lead.update({ where: { id: lead.id }, data: { dmConfirmedAt: new Date() } });
        // Invite to follow, with a button to the profile — only if they don't
        // already follow (null = Meta didn't say: invite anyway).
        const follows = await getUserFollowStatus(accessToken, message.senderId);
        const username = automation.instagramAccount.username;
        if (follows !== true && username) {
          await sendDirectMessageWithLinkButton(accessToken, automation.instagramAccount.instagramId, message.senderId,
            CONFIRM[locale].follow, [{ title: CONFIRM[locale].followButton, url: `https://www.instagram.com/${username}/` }]);
        }
      }
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
