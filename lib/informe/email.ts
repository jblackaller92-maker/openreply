/**
 * The ISO Survey report email: the reader's country in big type, its map, four
 * figures, three highlights, its largest standards and ONE button, "View report".
 *
 * Mail-client safe on purpose: tables and inline styles only, images as hosted
 * PNG (Gmail drops SVG and data: URIs), no web font, and well under Gmail's
 * 102 KB clipping limit.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { getBaseUrl } from "@/lib/env";
import {
  COLOR,
  LABEL,
  REGION,
  TOPIC,
  certificates,
  countryByA2,
  formatNumber,
  growth,
  ordinal,
  rank,
  regionRank,
  type Country,
  type Locale,
} from "./datos";

const INK = "#0B1424";
const BG = "#EFEDE5";
const DISPLAY = "font-family:Cobbler,Helvetica,Arial,sans-serif;font-weight:800";
const UI = "font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif";

// Text tones the brand uses on the light background where the official colour
// fails contrast (same as the web).
const TEXT_COLOR: Record<string, string> = { "45001": "#B5560E", "50001": "#9A740C" };
const color = (k: string) => COLOR[k] ?? INK;
const textColor = (k: string) => TEXT_COLOR[k] ?? color(k);

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Highlight {
  k: string;
  big: string;
  text: string;
}

/** Three findings for the country, computed. Only standards with a real base. */
export function highlights(c: Country, locale: Locale): Highlight[] {
  const out: Highlight[] = [];
  const growing = Object.keys(c.d)
    .map((k) => ({ k, g: growth(c, k) }))
    .filter((x): x is { k: string; g: number } => x.g != null)
    .sort((a, b) => b.g - a.g)[0];
  if (growing) {
    const sign = growing.g >= 0 ? "+" : "";
    out.push({
      k: growing.k,
      big: `${sign}${Math.round(growing.g)}%`,
      text:
        locale === "es"
          ? `${LABEL[growing.k]} es la que más creció contra 2024 (${TOPIC.es[growing.k].toLowerCase()}).`
          : `${LABEL[growing.k]} grew the most versus 2024 (${TOPIC.en[growing.k].toLowerCase()}).`,
    });
  }
  const best = Object.keys(c.d)
    .filter((k) => certificates(c, k) >= 20)
    .map((k) => ({ k, r: rank(c, k) }))
    .sort((a, b) => a.r[0] / a.r[1] - b.r[0] / b.r[1])[0];
  if (best) {
    out.push({
      k: best.k,
      big: ordinal(best.r[0], locale),
      text:
        locale === "es"
          ? `de ${best.r[1]} países en ${LABEL[best.k]}: su mejor lugar en el mundo.`
          : `of ${best.r[1]} countries in ${LABEL[best.k]}: its best world rank.`,
    });
  }
  if (certificates(c, "9001")) {
    const [r, of] = regionRank(c, "9001");
    const region = REGION[c.r]?.[locale === "es" ? 0 : 1] ?? "";
    out.push({
      k: "9001",
      big: ordinal(r, locale),
      text: locale === "es" ? `de ${of} en ${region} en ISO 9001:2015.` : `of ${of} in ${region} in ISO 9001:2015.`,
    });
  }
  return out;
}

const COPY = {
  es: {
    subject: (p: string) => `${p} en el ISO Survey 2025: tu informe está listo`,
    preheader: (p: string, n: string, g: string, r: string, of: number) =>
      `${p}: ${n} certificados ISO 9001:2015 (${g}), lugar ${r} de ${of}. Ábrelo aquí.`,
    kicker: "ISO Survey 2025 · Tu informe",
    lead: "certificados ISO 9001:2015",
    vs: "contra 2024",
    world: "lugar en el mundo",
    region: "en su región",
    standards: "normas en tu informe",
    stand: "Lo que destaca",
    table: "Sus normas más grandes",
    cols: ["Norma", "Certificados", "vs 2024", "Lugar"],
    button: "Ver informe",
    buttonSub: (p: string) => `Explora el mapa, el ranking 2024 → 2025 y compara ${p} con cualquier país.`,
    footer:
      "Recibiste este correo porque pediste el informe a FVR. El botón abre tu informe sin contraseña. Fuente: ISO Survey 2025 (ISO/CASCO), compilado desde IAF CertSearch. Fides Veritas Register INC · 7550 I-10 Ste 800, San Antonio, TX 78229, EE. UU.",
    privacy: "Aviso de privacidad",
    privacyUrl: "https://www.fvr.mx/privacidad",
    unsubscribe: "Darme de baja",
  },
  en: {
    subject: (p: string) => `${p} in the ISO Survey 2025: your report is ready`,
    preheader: (p: string, n: string, g: string, r: string, of: number) =>
      `${p}: ${n} ISO 9001:2015 certificates (${g}), rank ${r} of ${of}. Open it here.`,
    kicker: "ISO Survey 2025 · Your report",
    lead: "ISO 9001:2015 certificates",
    vs: "vs 2024",
    world: "world rank",
    region: "in its region",
    standards: "standards in your report",
    stand: "What stands out",
    table: "Its largest standards",
    cols: ["Standard", "Certificates", "vs 2024", "Rank"],
    button: "View report",
    buttonSub: (p: string) => `Explore the map, the 2024 → 2025 ranking and compare ${p} with any country.`,
    footer:
      "You received this email because you requested the report from FVR. The button opens your report without a password. Source: ISO Survey 2025 (ISO/CASCO), compiled from IAF CertSearch. Fides Veritas Register INC · 7550 I-10 Ste 800, San Antonio, TX 78229, USA.",
    privacy: "Privacy notice",
    privacyUrl: "https://www.fvr.mx/en/privacidad",
    unsubscribe: "Unsubscribe",
  },
} as const;

export interface ReportEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildReportEmail(args: {
  countryA2: string | null;
  locale: Locale;
  reportUrl: string;
  unsubscribeUrl: string;
}): ReportEmail {
  const { locale, reportUrl, unsubscribeUrl } = args;
  const t = COPY[locale];
  const c = countryByA2(args.countryA2) ?? countryByA2(locale === "es" ? "MX" : "US")!;
  const name = locale === "es" ? c.es : c.en;
  const base = getBaseUrl();

  const n9 = certificates(c, "9001");
  const g9 = growth(c, "9001");
  const g9txt = g9 == null ? "—" : `${g9 >= 0 ? "+" : ""}${Math.round(g9)}%`;
  const [r9, of9] = rank(c, "9001");
  const [rr, ofr] = regionRank(c, "9001");
  const hasMap = existsSync(path.join(process.cwd(), "public", "informe-img", "mapas", `${c.a2.toLowerCase()}.png`));

  const tiles = [
    [g9txt, t.vs, g9 != null && g9 < 0 ? "#7A2828" : "#4E8A26"],
    [r9 ? ordinal(r9, locale) : "—", `${t.world} · ${of9}`, INK],
    [rr ? ordinal(rr, locale) : "—", `${t.region} · ${ofr}`, INK],
    [String(Object.keys(c.d).length), t.standards, INK],
  ]
    .map(
      ([big, small, col]) =>
        `<td width="25%" style="padding:14px 10px 0 0;border-top:2px solid ${INK};vertical-align:top"><div style="${DISPLAY};font-size:28px;line-height:1;color:${col}">${esc(big)}</div><div style="${UI};font-size:12px;color:rgba(11,20,36,.62);margin-top:6px">${esc(small)}</div></td>`
    )
    .join("");

  const highlightsHtml = highlights(c, locale)
    .map(
      (h) =>
        `<tr><td width="6" style="background:${color(h.k)}"></td><td style="padding:14px 16px;background:#ffffff"><div style="${DISPLAY};font-size:26px;line-height:1;color:${textColor(h.k)}">${esc(h.big)}</div><div style="${UI};font-size:14px;line-height:1.45;color:rgba(11,20,36,.75);margin-top:6px">${esc(h.text)}</div></td></tr><tr><td colspan="2" height="8"></td></tr>`
    )
    .join("");

  const rows = Object.entries(c.d)
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, 6)
    .map(([k, v]) => {
      const [r, of] = rank(c, k);
      const pos = Math.max(1, Math.round((1 - (r - 1) / Math.max(1, of - 1)) * 100));
      const g = growth(c, k);
      const gtxt = g == null ? "—" : `${g >= 0 ? "+" : ""}${Math.round(g)}%`;
      const cell = `border-bottom:1px solid rgba(11,20,36,.12)`;
      return (
        `<tr><td style="padding:12px 0;${cell}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="10" height="10" style="background:${color(k)};border-radius:5px"></td><td style="padding-left:10px;${DISPLAY};font-size:15px">${esc(LABEL[k])}</td></tr></table>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr><td width="${pos}%" height="4" style="background:${color(k)}"></td><td height="4" style="background:rgba(11,20,36,.08)"></td></tr></table></td>` +
        `<td align="right" style="padding:12px 0 12px 12px;${cell};${DISPLAY};font-size:16px">${formatNumber(v[0])}</td>` +
        `<td align="right" style="padding:12px 0 12px 12px;${cell};${UI};font-size:13px;font-weight:700;color:${g != null && g < 0 ? "#7A2828" : "#4E8A26"}">${gtxt}</td>` +
        `<td align="right" style="padding:12px 0 12px 12px;${cell};${UI};font-size:13px;white-space:nowrap">${ordinal(r, locale)} <span style="color:rgba(11,20,36,.5)">/ ${of}</span></td></tr>`
      );
    })
    .join("");

  const th = t.cols
    .map(
      (x, i) =>
        `<td${i ? ' align="right"' : ""} style="${UI};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:0 0 8px ${i ? "12px" : "0"};border-bottom:2px solid ${INK}">${x}</td>`
    )
    .join("");

  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.subject(name))}</title></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(t.preheader(name, formatNumber(n9), g9txt, r9 ? ordinal(r9, locale) : "—", of9))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:${BG};color:${INK}">
 <tr><td style="padding:28px 32px 8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><img src="${base}/informe-img/logo.png" alt="FVR" width="74" height="24" style="display:block;width:74px;height:24px;border:0"></td>
   <td align="right" style="${UI};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7A2828">${t.kicker}</td></tr></table>
  <div style="${DISPLAY};font-size:64px;line-height:.95;letter-spacing:-2px;color:#d8c4c0;margin-top:30px">${esc(name.toUpperCase())}</div>
  <div style="${DISPLAY};font-size:76px;line-height:.9;letter-spacing:-3px;color:${INK};margin-top:-18px">${formatNumber(n9)}</div>
  <div style="${UI};font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7A2828;margin-top:12px">${t.lead}</div>
 </td></tr>
 ${hasMap ? `<tr><td style="padding:18px 16px 0"><img src="${base}/informe-img/mapas/${c.a2.toLowerCase()}.png" width="608" alt="${esc(name)}" style="display:block;width:100%;max-width:608px;height:auto;border:0"></td></tr>` : ""}
 <tr><td style="padding:12px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tiles}</tr></table></td></tr>
 <tr><td style="padding:32px 32px 0">
  <div style="${UI};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">${t.stand}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${highlightsHtml}</table>
 </td></tr>
 <tr><td style="padding:24px 32px 0">
  <div style="${UI};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">${t.table}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${th}</tr>${rows}</table>
 </td></tr>
 <tr><td style="padding:32px 32px 0">
  <a href="${reportUrl}" style="display:block;background:${INK};color:#ffffff;text-decoration:none;text-align:center;${DISPLAY};font-size:21px;padding:20px;border-radius:999px">${t.button} →</a>
  <div style="${UI};font-size:14px;color:rgba(11,20,36,.7);text-align:center;margin-top:12px">${esc(t.buttonSub(name))}</div>
 </td></tr>
 <tr><td style="padding:32px 32px 30px"><div style="${UI};font-size:11px;line-height:1.55;color:rgba(11,20,36,.55);border-top:1px solid rgba(11,20,36,.14);padding-top:16px">${esc(t.footer)}<br><br><a href="${t.privacyUrl}" style="color:#3a4f8a">${t.privacy}</a> · <a href="${unsubscribeUrl}" style="color:#3a4f8a">${t.unsubscribe}</a></div></td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    t.subject(name),
    "",
    `${formatNumber(n9)} ${t.lead} · ${g9txt} ${t.vs} · ${r9 ? ordinal(r9, locale) : "—"} ${t.world} (${of9})`,
    "",
    `${t.button}: ${reportUrl}`,
    "",
    t.footer,
    `${t.privacy}: ${t.privacyUrl}`,
    `${t.unsubscribe}: ${unsubscribeUrl}`,
  ].join("\n");

  return { subject: t.subject(name), html, text };
}

// ---------------------------------------------------------------- sending

export class EmailSendError extends Error {}

function sender(): string {
  const configured = process.env.INFORME_EMAIL_FROM ?? process.env.EMAIL_FROM ?? "notificaciones@fvr.mx";
  // EMAIL_FROM may be a bare address (it is in production); give it a name.
  return configured.includes("<") ? configured : `FVR · Fides Veritas Register <${configured}>`;
}

/** Sends through Resend's HTTP API, the same account OpenReply uses for login links. */
export async function sendReportEmail(to: string, email: ReportEmail, unsubscribeUrl: string): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new EmailSendError("RESEND_API_KEY is not set");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender(),
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) throw new EmailSendError(body.message ?? `Resend responded ${response.status}`);
  return body.id ?? "";
}
