/**
 * The "follow first" prompt of a follow-gated campaign.
 *
 * Instagram has no button that follows an account for the user, so the prompt
 * makes the two steps easy instead: one button opens the profile (to tap
 * Follow there) and the other, a postback, re-checks and delivers.
 *
 * Three shapes, tried in order:
 *   1. card (generic template): image + title + subtitle + both buttons. Only
 *      for campaigns that define one — today the ISO Survey lead campaigns.
 *   2. button template: the prompt text + both buttons.
 *   3. button template with the postback alone (what every campaign sent
 *      before), so a rejected profile button never leaves the user without a
 *      way forward.
 *
 * A comment allows ONE private reply, so on that path the card carries the
 * whole instruction in its subtitle.
 */
import { getBaseUrl } from "@/lib/env";
import { renderMessageWithoutLink } from "@/lib/tracking/message";
import { sendTemplateMessage } from "./client";

export interface FollowGatedCampaign {
  id: string;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  collectEmail: boolean;
  leadLocale: string | null;
  instagramAccount: { instagramId: string; username: string };
}

export type FollowPromptRecipient = { commentId: string } | { userId: string };

const SPANISH = /[áéíóúñ¿¡]/i;

function isSpanish(c: FollowGatedCampaign): boolean {
  if (c.leadLocale) return c.leadLocale !== "en";
  return SPANISH.test(c.followPromptMessage ?? "");
}

/** The card of the ISO Survey campaigns, in the campaign's language. */
function surveyCard(c: FollowGatedCampaign) {
  if (!c.collectEmail) return null;
  const es = isSpanish(c);
  const user = c.instagramAccount.username;
  return {
    title: es ? "Tu informe ISO Survey 2025" : "Your ISO Survey 2025 report",
    subtitle: es
      ? `Síguenos en @${user} y toca «Ya los sigo» para recibirlo en tu correo.`
      : `Follow @${user}, then tap «I'm following» to get it by email.`,
    image_url: `${getBaseUrl()}/informe-img/tarjeta-seguir-${es ? "es" : "en"}.jpg`,
  };
}

export async function sendFollowPrompt(args: {
  accessToken: string;
  campaign: FollowGatedCampaign;
  to: FollowPromptRecipient;
  commenterName: string | null;
  defaultText: string;
}): Promise<void> {
  const { accessToken, campaign: c, to, commenterName } = args;
  const recipient = "commentId" in to ? { comment_id: to.commentId } : { id: to.userId };
  const es = isSpanish(c);
  const confirm = {
    type: "postback",
    title: (c.followPromptButtonLabel || (es ? "Ya los sigo ✅" : "I'm following ✅")).slice(0, 20),
    payload: `followcheck:${c.id}`,
  };
  const profile = {
    type: "web_url",
    title: (es ? `Ir al perfil` : `Open profile`).slice(0, 20),
    url: `https://www.instagram.com/${c.instagramAccount.username}/`,
  };
  const text = renderMessageWithoutLink({
    message: c.followPromptMessage || args.defaultText,
    commenterName,
  }).slice(0, 640);
  const ig = c.instagramAccount.instagramId;

  const card = surveyCard(c);
  if (card) {
    try {
      await sendTemplateMessage(accessToken, ig, recipient, {
        template_type: "generic",
        elements: [{ ...card, buttons: [profile, confirm] }],
      });
      return;
    } catch (error) {
      console.error("[Follow prompt] Card rejected, sending buttons:", error instanceof Error ? error.message : error);
    }
  }
  try {
    await sendTemplateMessage(accessToken, ig, recipient, { template_type: "button", text, buttons: [profile, confirm] });
    return;
  } catch (error) {
    console.error("[Follow prompt] Two buttons rejected, sending one:", error instanceof Error ? error.message : error);
  }
  await sendTemplateMessage(accessToken, ig, recipient, { template_type: "button", text, buttons: [confirm] });
}
