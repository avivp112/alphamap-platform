import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Eye, Search, X } from "lucide-react";
import { CompanyLogo } from "../CompanyLogo";
import { fetchInvestors, fetchStartupsPage, type InvestorRow, type StartupListRow } from "../../../lib/supabase";
import { addToWatchlist, removeFromWatchlist, watchlistErrorMessage } from "../../../lib/watchlist";
import { BENCH_SEATS, daysAgo, monthYear, refKey, relativeTime } from "../../../lib/alpha";
import { addToBench, fetchBench } from "../../../lib/alphaData";
import { EmptyState, ErrorLine, Spinner, StageChip } from "./AlphaBits";
import type { AlphaData } from "./useAlphaData";
import { useAlphaT } from "./useAlphaT";

const STALE_DAYS = 90;

export function WatchlistTab({ data }: { data: AlphaData }) {
  const tt = useAlphaT();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ startups: StartupListRow[]; investors: InvestorRow[] } | null>(null);
  const [investors, setInvestors] = useState<InvestorRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const rows = useMemo(() => {
    const out = [...data.watchlist.startups.map((s) => `startup:${s.id}`), ...data.watchlist.investors.map((i) => `investor:${i.id}`)]
      .map((k) => data.entities.get(k)).filter((e): e is NonNullable<typeof e> => !!e);
    return out;
  }, [data.watchlist, data.entities]);
  const tracked = useMemo(() => new Set(rows.map((r) => refKey(r.ref))), [rows]);
  const benched = useMemo(() => new Set(data.bench.map((b) => refKey(b.ref))), [data.bench]);
  const crmByStartup = useMemo(() => new Map(data.crm.filter((c) => c.startup_id).map((c) => [c.startup_id as string, c])), [data.crm]);
  const stale = rows.filter((r) => (daysAgo(r.updatedAt) ?? 0) > STALE_DAYS).length;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound(null); return; }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const [s, inv] = await Promise.all([fetchStartupsPage({ search: term }, 1), investors ? Promise.resolve(investors) : fetchInvestors().then((r) => { setInvestors(r); return r; })]);
        const low = term.toLowerCase();
        if (!cancelled) setFound({ startups: s.slice(0, 6), investors: inv.filter((i) => i.name.toLowerCase().includes(low)).slice(0, 6) });
      } catch { if (!cancelled) setFound({ startups: [], investors: [] }); }
    }, 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setProblem(null);
    try { await fn(); } catch (e) { setProblem(watchlistErrorMessage(e)); } finally { setBusy(null); }
  }
  const follow = (type: "startup" | "investor", id: string) => act(`${type}:${id}`, async () => { await addToWatchlist(type, id); data.reload(); });
  const unfollow = (type: "startup" | "investor", id: string) => act(`${type}:${id}`, async () => { await removeFromWatchlist(type, id); data.reload(); });
  const promote = (e: (typeof rows)[number]) => act(refKey(e.ref), async () => { await addToBench(e.ref); data.setBench(await fetchBench()); });

  if (data.loading) return <Spinner label={tt("loading", "Loading")} />;
  if (data.error) return <ErrorLine message={data.error} />;

  const results = found && (found.startups.length + found.investors.length > 0 || q.trim().length >= 2) ? found : null;

  return (
    <div className="space-y-4">
      <div className="relative max-w-xl">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-am-ink-3" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={tt("addSearch", "Find a company or fund to follow")} placeholder={tt("addSearch", "Find a company or fund to follow")}
          className="w-full h-10 ps-10 pe-9 rounded-am-ctl border border-am-line bg-am-surface text-am-body focus:outline-none focus:ring-2 focus:ring-am-accent/30" />
        {q && <button type="button" onClick={() => setQ("")} aria-label={tt("clear", "Clear")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-am-ink-3 hover:bg-am-canvas"><X className="w-4 h-4" aria-hidden="true" /></button>}
        {results && (
          <ul className="absolute z-20 left-0 right-0 mt-1.5 max-h-80 overflow-y-auto rounded-am-card border border-am-line bg-am-surface shadow-am-2 py-1">
            {results.startups.length + results.investors.length === 0 && <li className="px-4 py-3 text-am-body text-am-ink-3">{tt("noResults", "No match.")}</li>}
            {[...results.startups.map((s) => ({ type: "startup" as const, id: s.id, name: s.name, website: s.website, sub: s.industry })),
              ...results.investors.map((i) => ({ type: "investor" as const, id: i.id, name: i.name, website: i.website, sub: i.headquarters }))].map((r) => (
              <li key={`${r.type}:${r.id}`} className="flex items-center gap-3 px-3 py-2">
                <CompanyLogo name={r.name} website={r.website} size={26} rounded="rounded-md" />
                <span className="min-w-0 flex-1"><span className="block text-am-body font-medium truncate">{r.name}</span><span className="block text-am-caption text-am-ink-3 truncate">{r.type === "investor" ? "VC" : r.sub ?? "—"}</span></span>
                {tracked.has(`${r.type}:${r.id}`) ? <span className="text-am-caption text-am-ink-3">{tt("following", "Following")}</span> : (
                  <button type="button" disabled={busy === `${r.type}:${r.id}`} onClick={() => follow(r.type, r.id)}
                    className="h-8 px-3 rounded-am-ctl bg-am-ink text-white text-am-body font-semibold hover:bg-slate-800 disabled:opacity-50">{tt("follow", "Follow")}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {problem && <ErrorLine message={problem} />}

      {rows.length === 0 ? (
        <EmptyState icon={<Eye className="w-8 h-8" />} title={tt("wlEmptyTitle", "You are not following anything yet")}
          body={tt("wlEmptyBody", "Follow a company or a fund and its filings and updates show up in your Alpha.")} />
      ) : (
        <div className="bg-am-surface border border-am-line rounded-am-card shadow-am-1 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-am-line">
            <h2 className="text-am-title font-semibold text-am-ink flex-1">{tt("watchlist", "Watchlist")} <span className="text-am-ink-3 font-medium tabular-nums">{rows.length}</span></h2>
            {stale > 0 && <span className="text-am-caption text-am-warn">{tt("stale", "{{count}} not updated in over 90 days", { count: stale })}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-am-body text-am-ink border-separate border-spacing-0">
              <thead>
                <tr className="text-am-caption text-am-ink-3">
                  <th scope="col" className="text-start font-medium px-5 h-9 border-b border-am-line">{tt("colCompany", "Company")}</th>
                  <th scope="col" className="text-start font-medium px-3 h-9 border-b border-am-line">{tt("colRound", "Last round")}</th>
                  <th scope="col" className="text-end font-medium px-3 h-9 border-b border-am-line">{tt("colUpdated", "Record updated")}</th>
                  <th scope="col" className="text-start font-medium px-3 h-9 border-b border-am-line">{tt("colPipeline", "Pipeline")}</th>
                  <th scope="col" className="px-3 h-9 border-b border-am-line"><span className="sr-only">{tt("actions", "Actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const crm = e.ref.type === "startup" ? crmByStartup.get(e.ref.id) : undefined;
                  const age = daysAgo(e.updatedAt);
                  const isBenched = benched.has(refKey(e.ref));
                  const key = refKey(e.ref);
                  return (
                    <tr key={key} className="hover:bg-am-canvas">
                      <td className="px-5 py-3 border-b border-am-line-soft">
                        <div className="flex items-center gap-3 min-w-0">
                          <CompanyLogo name={e.name} website={e.website} size={32} rounded="rounded-lg" />
                          <div className="min-w-0">
                            <Link to={e.href} className="block font-semibold truncate hover:text-am-accent">{e.name}</Link>
                            <p className="text-am-caption text-am-ink-3 truncate">{e.subtitle ?? "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 border-b border-am-line-soft text-am-ink-2 whitespace-nowrap">
                        {e.lastRound ? [e.lastRound.type, monthYear(e.lastRound.date, lang)].filter(Boolean).join(" · ") || "—" : "—"}
                      </td>
                      <td className={`px-3 py-3 border-b border-am-line-soft text-end whitespace-nowrap tabular-nums ${age != null && age > STALE_DAYS ? "text-am-warn font-medium" : "text-am-ink-2"}`}>
                        {e.updatedAt ? relativeTime(e.updatedAt, lang) : "—"}
                      </td>
                      <td className="px-3 py-3 border-b border-am-line-soft">{crm ? <StageChip stage={crm.stage} label={tt(`stage_${crm.stage}`, crm.stage.replace("_", " "))} /> : <span className="text-am-ink-3">—</span>}</td>
                      <td className="px-3 py-3 border-b border-am-line-soft text-end whitespace-nowrap">
                        <button type="button" disabled={isBenched || data.bench.length >= BENCH_SEATS || busy === key || !!data.benchError} onClick={() => promote(e)}
                          title={isBenched ? tt("onBench", "On your bench") : data.bench.length >= BENCH_SEATS ? tt("benchFull", "The bench is full") : undefined}
                          className="h-8 px-3 rounded-am-ctl border border-am-line bg-am-surface text-am-body font-medium hover:bg-am-canvas disabled:opacity-50 disabled:cursor-not-allowed">
                          {isBenched ? tt("onBench", "On your bench") : tt("promote", "Promote")}
                        </button>
                        <button type="button" disabled={busy === key} onClick={() => unfollow(e.ref.type as "startup" | "investor", e.ref.id)}
                          aria-label={tt("unfollow", "Stop following {{name}}", { name: e.name })}
                          className="ms-1 p-2 rounded-full text-am-ink-3 hover:bg-am-line hover:text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40"><X className="w-4 h-4" aria-hidden="true" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
