import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/meta/client", () => ({ sendTemplateMessage: send }));
vi.mock("@/lib/env", () => ({ getBaseUrl: () => "https://mkt.fvr.mx" }));

import { sendFollowPrompt, type FollowGatedCampaign } from "@/lib/meta/follow-prompt";

const survey: FollowGatedCampaign = {
  id: "auto_1",
  followPromptMessage: "¡Hola, {username}! Síguenos y toca el botón 👇",
  followPromptButtonLabel: "Ya los sigo ✅",
  collectEmail: true,
  leadLocale: "es",
  instagramAccount: { instagramId: "ig_1", username: "fvr.mx" },
};

describe("follow prompt", () => {
  beforeEach(() => send.mockReset().mockResolvedValue({ recipient_id: "r", message_id: "m" }));

  it("sends the Survey campaigns a card with the profile and the confirm buttons", async () => {
    await sendFollowPrompt({ accessToken: "t", campaign: survey, to: { commentId: "c_1" }, commenterName: "ana", defaultText: "" });
    expect(send).toHaveBeenCalledTimes(1);
    const [, , recipient, payload] = send.mock.calls[0];
    expect(recipient).toEqual({ comment_id: "c_1" });
    expect(payload.template_type).toBe("generic");
    const card = payload.elements[0];
    expect(card.title).toBe("Tu informe ISO Survey 2025");
    expect(card.subtitle).toContain("@fvr.mx");
    expect(card.subtitle.length).toBeLessThanOrEqual(80);
    expect(card.image_url).toBe("https://mkt.fvr.mx/informe-img/tarjeta-seguir-es.jpg");
    expect(card.buttons).toEqual([
      { type: "web_url", title: "Ir al perfil", url: "https://www.instagram.com/fvr.mx/" },
      { type: "postback", title: "Ya los sigo ✅", payload: "followcheck:auto_1" },
    ]);
  });

  it("speaks English on the US account", async () => {
    await sendFollowPrompt({
      accessToken: "t",
      campaign: { ...survey, leadLocale: "en", followPromptButtonLabel: "I'm following ✅", instagramAccount: { instagramId: "ig_2", username: "fvr.usa" } },
      to: { userId: "u_1" }, commenterName: null, defaultText: "",
    });
    const card = send.mock.calls[0][3].elements[0];
    expect(card.title).toBe("Your ISO Survey 2025 report");
    expect(card.subtitle.length).toBeLessThanOrEqual(80);
    expect(card.buttons[0].title).toBe("Open profile");
  });

  it("falls back to two buttons when the card is rejected, then to the confirm button alone", async () => {
    send.mockRejectedValueOnce(new Error("card")).mockRejectedValueOnce(new Error("two"));
    await sendFollowPrompt({ accessToken: "t", campaign: survey, to: { userId: "u_1" }, commenterName: "ana", defaultText: "" });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[1][3]).toMatchObject({ template_type: "button", text: "¡Hola, ana! Síguenos y toca el botón 👇" });
    expect(send.mock.calls[1][3].buttons).toHaveLength(2);
    expect(send.mock.calls[2][3].buttons).toEqual([{ type: "postback", title: "Ya los sigo ✅", payload: "followcheck:auto_1" }]);
  });

  it("gives other campaigns the two buttons, no card", async () => {
    await sendFollowPrompt({ accessToken: "t", campaign: { ...survey, collectEmail: false, leadLocale: null }, to: { userId: "u" }, commenterName: null, defaultText: "" });
    expect(send.mock.calls[0][3].template_type).toBe("button");
    expect(send.mock.calls[0][3].buttons).toHaveLength(2);
  });
});
