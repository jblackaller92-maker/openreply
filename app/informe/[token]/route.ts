import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { asLocale } from "@/lib/informe/leads";
import { PUBLIC_PATH, renderReportPage } from "@/lib/informe/html";

type Props = { params: Promise<{ token: string }> };

// The personal report, opened from the "View report" button of the email.
export async function GET(request: NextRequest, { params }: Props) {
  const { token } = await params;
  const lead = await prisma.lead.findUnique({
    where: { token },
    select: { id: true, countryA2: true, locale: true, reportOpenedAt: true },
  });

  const wanted = request.nextUrl.searchParams.get("lang");
  if (!lead) {
    // Unknown or mistyped link: send them to the public page, not a dead end.
    return NextResponse.redirect(new URL(PUBLIC_PATH[asLocale(wanted)], request.url), { status: 302 });
  }

  if (!lead.reportOpenedAt) {
    await prisma.lead.update({ where: { id: lead.id }, data: { reportOpenedAt: new Date() } });
  }

  const locale = asLocale(wanted ?? lead.locale);
  const other = locale === "es" ? "en" : "es";
  return renderReportPage(locale, {
    abierto: true,
    pais: lead.countryA2,
    otherLanguageUrl: `/informe/${token}?lang=${other}`,
  });
}
