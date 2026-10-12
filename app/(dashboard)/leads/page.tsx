/**
 * Leads: everyone who asked for the ISO Survey report and left an email,
 * from an Instagram DM or the public web form.
 */
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { countryByA2 } from "@/lib/informe/datos";

export const dynamic = "force-dynamic";

const th = "px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6";
const td = "px-4 py-3 sm:px-6";

function when(d: Date | null) {
  return d ? d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" }) : "—";
}

export default async function LeadsPage() {
  const workspaceId = await getCurrentWorkspaceId();
  const leads = workspaceId
    ? await prisma.lead.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { instagramAccount: { select: { username: true } }, automation: { select: { name: true } } },
      })
    : [];

  const total = leads.length;
  const opened = leads.filter((l) => l.reportOpenedAt).length;
  const optIn = leads.filter((l) => l.newsletterOptIn && !l.unsubscribedAt).length;
  const failed = leads.filter((l) => l.emailError && !l.emailSentAt).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Correos</h1>
          <p className="text-sm text-muted">Quienes pidieron el informe ISO Survey 2025 y dejaron su correo.</p>
        </div>
        <a href="/api/leads/export" className="rounded border border-border px-4 py-2 text-sm font-medium hover:bg-surface-hover">
          Exportar CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          [total, "contactos"],
          [opened, "abrieron el informe"],
          [optIn, "aceptaron el boletín"],
          [failed, "correo sin enviar"],
        ].map(([n, label]) => (
          <div key={String(label)} className="panel rounded p-4">
            <div className="text-2xl font-semibold">{n}</div>
            <div className="text-xs text-muted">{label}</div>
          </div>
        ))}
      </div>

      <div className="panel rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className={th}>Correo</th>
                <th className={th}>País</th>
                <th className={th}>Llegó por</th>
                <th className={th}>Instagram</th>
                <th className={th}>Correo enviado</th>
                <th className={th}>Abrió</th>
                <th className={th}>Boletín</th>
                <th className={th}>Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted sm:px-6">
                    Todavía nadie ha dejado su correo.
                  </td>
                </tr>
              ) : (
                leads.map((l) => (
                  <tr key={l.id} className="hover:bg-surface-hover/50 transition-colors">
                    <td className={`${td} font-medium`}>{l.email}</td>
                    <td className={td}>{countryByA2(l.countryA2)?.es ?? l.countryA2 ?? "—"}</td>
                    <td className={td}>
                      {l.source === "WEB" ? "Página web" : `DM · @${l.instagramAccount?.username ?? "?"}`}
                      <span className="block text-xs text-muted">{l.automation?.name ?? ""}</span>
                    </td>
                    <td className={td}>{l.igUsername ? `@${l.igUsername}` : "—"}</td>
                    <td className={td}>
                      {l.emailSentAt ? (
                        when(l.emailSentAt)
                      ) : (
                        <form action="/api/leads/resend" method="post" className="flex items-center gap-2">
                          <input type="hidden" name="id" value={l.id} />
                          <span className="text-xs text-red-600" title={l.emailError ?? ""}>no se envió</span>
                          <button className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-hover">Reenviar</button>
                        </form>
                      )}
                    </td>
                    <td className={td}>{when(l.reportOpenedAt)}</td>
                    <td className={td}>{l.unsubscribedAt ? "Baja" : l.newsletterOptIn ? "Sí" : "No"}</td>
                    <td className={td}>{when(l.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
