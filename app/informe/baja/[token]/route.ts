import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { asLocale } from "@/lib/informe/leads";

type Props = { params: Promise<{ token: string }> };

const COPY = {
  es: { title: "Darme de baja", ask: "¿Dejar de recibir correos de FVR en", button: "Sí, darme de baja", done: "Listo: ya no te escribiremos.", unknown: "Este enlace ya no es válido." },
  en: { title: "Unsubscribe", ask: "Stop receiving emails from FVR at", button: "Yes, unsubscribe", done: "Done: we won't email you again.", unknown: "This link is no longer valid." },
} as const;

function page(lang: "es" | "en", body: string) {
  return new Response(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${COPY[lang].title} · FVR</title></head>` +
      `<body style="margin:0;background:#EFEDE5;color:#0B1424;font-family:system-ui,-apple-system,sans-serif"><main style="max-width:480px;margin:18vh auto;padding:0 20px">${body}</main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// GET only asks. A link scanner that opens every URL in an email must not be
// able to unsubscribe anyone, so the change happens on POST.
export async function GET(_request: NextRequest, { params }: Props) {
  const { token } = await params;
  const lead = await prisma.lead.findUnique({ where: { token }, select: { email: true, locale: true } });
  const lang = asLocale(lead?.locale);
  if (!lead) return page(lang, `<p>${COPY[lang].unknown}</p>`);
  return page(
    lang,
    `<h1 style="font-size:1.6rem">${COPY[lang].title}</h1><p>${COPY[lang].ask} <b>${esc(lead.email)}</b>?</p>` +
      `<form method="post"><button style="font:inherit;font-weight:700;background:#0B1424;color:#fff;border:0;border-radius:999px;padding:.8rem 1.4rem;cursor:pointer">${COPY[lang].button}</button></form>`
  );
}

// POST: the button above, and the one-click List-Unsubscribe from mail clients.
export async function POST(_request: NextRequest, { params }: Props) {
  const { token } = await params;
  const lead = await prisma.lead.findUnique({ where: { token }, select: { email: true, locale: true } });
  const lang = asLocale(lead?.locale);
  if (!lead) return page(lang, `<p>${COPY[lang].unknown}</p>`);
  // Every request from the same address stops, not only this one.
  await prisma.lead.updateMany({
    where: { email: lead.email },
    data: { unsubscribedAt: new Date(), newsletterOptIn: false },
  });
  return page(lang, `<h1 style="font-size:1.6rem">${COPY[lang].done}</h1>`);
}
