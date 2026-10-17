import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { countryByA2 } from "@/lib/informe/datos";

const cell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV of every lead (DM, web form and other sites via /api/leads/ingest), for the
// mailing list and for anyone who asks what we hold.
export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const leads = await prisma.lead.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    include: { instagramAccount: { select: { username: true } } },
  });
  const header = ["email", "nombre", "empresa", "herramienta", "pais", "pais_codigo", "idioma", "origen", "cuenta", "instagram", "boletin", "baja", "correo_enviado", "abrio_informe", "fecha"];
  const rows = leads.map((l) =>
    [
      l.email,
      l.name,
      l.company,
      l.origin,
      countryByA2(l.countryA2)?.es ?? "",
      l.countryA2,
      l.locale,
      l.source,
      l.instagramAccount?.username ?? "",
      l.igUsername ?? "",
      l.newsletterOptIn && !l.unsubscribedAt ? "si" : "no",
      l.unsubscribedAt,
      l.emailSentAt,
      l.reportOpenedAt,
      l.createdAt,
    ].map(cell).join(",")
  );
  const csv = "﻿" + [header.join(","), ...rows].join("\n") + "\n";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="correos-iso-survey-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
