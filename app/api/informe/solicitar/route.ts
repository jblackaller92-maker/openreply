import Redis from "ioredis";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { countryByA2, isEmail } from "@/lib/informe/datos";
import { asLocale, captureLeadFromWeb } from "@/lib/informe/leads";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";

// The public form of /iso-survey posts here. Anyone can call it, so it is
// guarded three ways: a hidden field bots fill in, a per-IP hourly cap, and a
// ten-minute dedupe per address inside captureLeadFromWeb.

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  pais: z.string().trim().max(2).optional().nullable(),
  idioma: z.string().optional().nullable(),
  boletin: z.boolean().optional().default(false),
  sitio: z.string().optional().nullable(), // honeypot: humans never see it
});

const MAX_PER_HOUR = 5;
let redis: Redis | null = null;

async function overLimit(ipHash: string | null): Promise<boolean> {
  if (!ipHash || !process.env.REDIS_URL) return false;
  redis ??= new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
  const key = `informe:solicitar:${ipHash}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  return count > MAX_PER_HOUR;
}

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isEmail(parsed.data.email)) {
    return NextResponse.json({ success: false, error: "Invalid email" }, { status: 400 });
  }
  const { email, pais, idioma, boletin, sitio } = parsed.data;

  // A filled honeypot gets the same answer as a real request, and nothing happens.
  if (sitio) return NextResponse.json({ success: true });

  const ipHash = hashClickIp(getRequestIp(request));
  if (await overLimit(ipHash)) {
    return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 });
  }

  const result = await captureLeadFromWeb({
    email,
    countryA2: countryByA2(pais)?.a2 ?? null,
    locale: asLocale(idioma),
    newsletterOptIn: boletin,
    ipHash,
  });

  if (!result.ok) {
    console.error("[Informe] Web request failed:", result.error);
    return NextResponse.json({ success: false, error: "Could not send" }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
