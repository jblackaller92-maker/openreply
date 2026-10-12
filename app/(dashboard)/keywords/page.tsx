/**
 * Keyword registry: which word fires which campaign, on which account and
 * post. A word lives in ONE active campaign per account (the API refuses a
 * second), and "any post" campaigns answer on old posts as well as new ones.
 */
import Link from "next/link";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { keywordRegistry } from "@/lib/keywords/registry";

export const dynamic = "force-dynamic";

const th = "px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6";
const td = "px-4 py-3 sm:px-6";
const SCOPE = { ANY_POST: "Cualquier post (también los viejos)", NEXT_REEL: "El próximo reel", SPECIFIC_POST: "Un post específico" } as const;

export default async function KeywordsPage() {
  const workspaceId = await getCurrentWorkspaceId();
  const rows = workspaceId ? await keywordRegistry(workspaceId) : [];
  const active = rows.filter((r) => r.isActive);
  const paused = rows.filter((r) => !r.isActive);

  const table = (list: typeof rows) => (
    <div className="panel rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className={th}>Palabra</th>
              <th className={th}>Cuenta</th>
              <th className={th}>Campaña</th>
              <th className={th}>Dónde responde</th>
              <th className={th}>DMs enviados</th>
              <th className={th}>Creada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted sm:px-6">Nada aquí.</td></tr>
            ) : (
              list.map((r) => (
                <tr key={`${r.campaignId}-${r.keyword}`} className="hover:bg-surface-hover/50 transition-colors">
                  <td className={`${td} font-mono font-semibold`}>
                    {r.keyword}
                    {r.duplicated ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">repetida</span> : null}
                  </td>
                  <td className={td}>@{r.account}</td>
                  <td className={td}><Link className="underline" href={`/campaigns/${r.campaignId}/edit`}>{r.campaignName}</Link></td>
                  <td className={td}>
                    {SCOPE[r.scope]}
                    {r.scope === "SPECIFIC_POST" && r.postUrl ? (
                      <a className="ml-1 underline" href={r.postUrl} target="_blank" rel="noreferrer">ver post</a>
                    ) : null}
                  </td>
                  <td className={td}>{r.sent}</td>
                  <td className={td}>{r.createdAt.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Palabras clave</h1>
        <p className="text-sm text-muted">
          Cada palabra vive en UNA campaña activa por cuenta: openreply no deja guardar otra que la repita. Las campañas de
          «cualquier post» responden también en posts viejos.
        </p>
      </div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Activas · {active.length}</h2>
      {table(active)}
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Pausadas · {paused.length}</h2>
      {table(paused)}
    </div>
  );
}
