import { NextRequest, NextResponse } from "next/server";
import { ingestLead, ingestSchema, parseIngestKeys, workspaceForKey } from "@/lib/leads/ingest";

// Server-to-server door for leads captured on other sites (e.g. the Señor
// Auditor self-assessment). Auth: `Authorization: Bearer <key>`, where the key
// is bound to one workspace in LEADS_INGEST_KEYS. Never called from a browser.
export async function POST(request: NextRequest) {
  const workspaceId = workspaceForKey(request.headers.get("authorization"), parseIngestKeys(process.env.LEADS_INGEST_KEYS));
  if (!workspaceId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const parsed = ingestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid body", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  }
  const result = await ingestLead(workspaceId, parsed.data);
  if (!result.ok) {
    const status = result.error === "Invalid email" ? 400 : 500;
    if (status === 500) console.error("[Ingest] Could not save lead:", result.error);
    return NextResponse.json({ success: false, error: result.error }, { status });
  }
  return NextResponse.json({ success: true, id: result.id });
}
