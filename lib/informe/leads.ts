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
import { sendFollowPrompt } from "@/lib/meta/follow-prompt";
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
    pending: (email: string) =>
      `¡Gracias! 🙌 Ya tenemos tu correo: ${email}.\n\nÚltimo paso: síguenos y toca «Ya los sigo» para que te mandemos tu informe 👇`,
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
    pending: (email: string) =>
      `Thanks! 🙌 We've got your email: ${email}.\n\nOne last step: follow us and tap «I'm following» so we can send your report 👇`,
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

  // The email is saved first, always: the person already gave it.
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

  if (!automation.instagramAccount.accessToken) {
    await deliverReport(lead.id);
    return true;
  }
  const accessToken = decryptToken(automation.instagramAccount.accessToken);

  // Follow gate, AFTER the email (director, 12-oct): a non-follower keeps the
  // lead pending and gets the follow card; its «I'm following» tap re-checks
  // and sends the report (finishLeadAfterFollow). Unknown (null) goes through,
  // so a real follower is never trapped.
  if (automation.requireFollow && (await getUserFollowStatus(accessToken, message.senderId)) === false) {
    try {
      await sendDirectMessage(accessToken, automation.instagramAccount.instagramId, message.senderId, CONFIRM[locale].pending(email));
      await sendFollowPrompt({
        accessToken,
        campaign: automation,
        to: { userId: message.senderId },
        commenterName: prior?.commenterName ?? null,
        defaultText: "",
      });
    } catch (error) {
      console.error("[Leads] Could not send the follow prompt:", error instanceof Error ? error.message : error);
    }
    return true;
  }

  await deliverAndConfirm({ leadId: lead.id, automation, userId: message.senderId, accessToken, inviteToFollow: true });
  return true;
}

type LeadCampaign = {
  instagramAccountId: string;
  instagramAccount: { instagramId: string; username: string };
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  collectEmail: boolean;
  leadLocale: string | null;
  id: string;
};

/** Sends the report of a lead and confirms in the chat. */
async function deliverAndConfirm(args: {
  leadId: string;
  automation: LeadCampaign;
  userId: string;
  accessToken: string;
  inviteToFollow: boolean;
}): Promise<void> {
  const { automation, userId, accessToken } = args;
  const result = await deliverReport(args.leadId);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: args.leadId } });
  const locale = asLocale(lead.locale);
  try {
    const country = countryByA2(lead.countryA2);
    const name = country ? (locale === "es" ? country.es : country.en) : (lead.countryA2 ?? "");
    const guessed = !findCountry(lead.countryRaw ?? "");
    const text = result.ok ? CONFIRM[locale].ok(name, lead.email, guessed) : CONFIRM[locale].failed(lead.email);
    await sendDirectMessage(accessToken, automation.instagramAccount.instagramId, userId, text);
    if (!result.ok) return;
    await prisma.lead.update({ where: { id: lead.id }, data: { dmConfirmedAt: new Date() } });
    // Invite to follow, with a button to the profile — only if they don't
    // already follow (null = Meta didn't say: invite anyway).
    if (args.inviteToFollow) {
      const follows = await getUserFollowStatus(accessToken, userId);
      const username = automation.instagramAccount.username;
      if (follows !== true && username) {
        await sendDirectMessageWithLinkButton(accessToken, automation.instagramAccount.instagramId, userId,
          CONFIRM[locale].follow, [{ title: CONFIRM[locale].followButton, url: `https://www.instagram.com/${username}/` }]);
      }
    }
  } catch (error) {
    console.error("[Leads] Could not confirm in the chat:", error instanceof Error ? error.message : error);
  }
}

/**
 * The «I'm following» tap of a lead campaign. If the person left an email that
 * is still waiting for the follow, verify the follow and send the report (or
 * the card again). Returns false when there is no pending email, so the worker
 * carries on with its normal flow (asking for the email).
 */
export async function finishLeadAfterFollow(args: {
  automation: LeadCampaign;
  userId: string;
  accessToken: string;
  commenterName: string | null;
}): Promise<boolean> {
  const { automation, userId, accessToken } = args;
  const pending = await prisma.lead.findFirst({
    where: {
      igUserId: userId,
      instagramAccountId: automation.instagramAccountId,
      source: "INSTAGRAM_DM",
      emailSentAt: null,
      unsubscribedAt: null,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) return false;

  if (automation.requireFollow && (await getUserFollowStatus(accessToken, userId)) === false) {
    try {
      await sendFollowPrompt({ accessToken, campaign: automation, to: { userId }, commenterName: args.commenterName, defaultText: "" });
    } catch (error) {
      console.error("[Leads] Could not re-send the follow prompt:", error instanceof Error ? error.message : error);
    }
    return true;
  }
  await deliverAndConfirm({ leadId: pending.id, automation, userId, accessToken, inviteToFollow: false });
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
