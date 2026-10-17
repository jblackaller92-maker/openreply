/**
 * Leads that arrive from other sites (server to server), e.g. the Señor Auditor
 * self-assessment. Each caller gets its own key, and each key is bound to ONE
 * workspace: the caller never chooses where its leads land.
 *
 *   LEADS_INGEST_KEYS='{"<long random key>": "<workspaceId>"}'
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { isEmail } from "@/lib/informe/datos";
import { newToken } from "@/lib/informe/leads";

export const ingestSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  name: z.string().trim().max(120).optional().nullable(),
  company: z.string().trim().max(160).optional().nullable(),
  origin: z.string().trim().min(1).max(60),
  locale: z.enum(["es", "en"]).optional().default("es"),
  newsletterOptIn: z.boolean().optional().default(false),
  consent: z.literal(true),
  data: z.record(z.string(), z.unknown()).optional().nullable(),
});
export type IngestInput = z.infer<typeof ingestSchema>;

/** Parses LEADS_INGEST_KEYS. Bad JSON or short keys disable ingest instead of failing open. */
export function parseIngestKeys(raw: string | undefined): Map<string, string> {
  const keys = new Map<string, string>();
  if (!raw) return keys;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return keys;
    for (const [key, workspaceId] of Object.entries(parsed)) {
      if (key.length >= 32 && typeof workspaceId === "string" && workspaceId) keys.set(key, workspaceId);
    }
  } catch {
    console.error("[Ingest] LEADS_INGEST_KEYS is not valid JSON; ingest disabled");
  }
  return keys;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Workspace bound to the bearer key, compared in constant time. */
export function workspaceForKey(authorization: string | null, keys: Map<string, string>): string | null {
  const presented = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!presented) return null;
  const p = digest(presented);
  let found: string | null = null;
  for (const [key, workspaceId] of keys) {
    if (timingSafeEqual(p, digest(key))) found = workspaceId;
  }
  return found;
}

/**
 * Saves the lead. The same address from the same tool within ten minutes
 * updates the earlier row instead of creating a duplicate.
 */
export async function ingestLead(workspaceId: string, input: IngestInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isEmail(input.email)) return { ok: false, error: "Invalid email" };
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!workspace) return { ok: false, error: "Workspace not found" };

  const fields = {
    name: input.name || null,
    company: input.company || null,
    newsletterOptIn: input.newsletterOptIn,
    locale: input.locale,
    data: (input.data ?? undefined) as object | undefined,
  };
  const recent = await prisma.lead.findFirst({
    where: { workspaceId, email: input.email, origin: input.origin, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
    select: { id: true },
  });
  if (recent) {
    // A resubmission only adds: it never blanks a name/company it didn't send,
    // and never withdraws a newsletter opt-in (that is what unsubscribe is for).
    await prisma.lead.update({
      where: { id: recent.id },
      data: {
        ...(fields.name ? { name: fields.name } : {}),
        ...(fields.company ? { company: fields.company } : {}),
        ...(fields.newsletterOptIn ? { newsletterOptIn: true } : {}),
        ...(fields.data ? { data: fields.data } : {}),
        locale: fields.locale,
      },
    });
    return { ok: true, id: recent.id };
  }
  const lead = await prisma.lead.create({
    data: { workspaceId, source: "WEB", email: input.email, origin: input.origin, token: newToken(), ...fields },
    select: { id: true },
  });
  return { ok: true, id: lead.id };
}
