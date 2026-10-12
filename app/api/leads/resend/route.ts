import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { deliverReport } from "@/lib/informe/leads";

// "Reenviar" on the Correos page, for a report email that failed to send.
export async function POST(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const lead = await prisma.lead.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (lead) await deliverReport(lead.id);
  return NextResponse.redirect(new URL("/leads", request.url), { status: 303 });
}
