import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Sparkles } from "lucide-react";
import { CompanyLogo } from "../CompanyLogo";
import {
  fetchPreferenceSignalCount, fetchStartupsByIds, fetchTopThesisMatches, logInteraction, type StartupListRow, type ThesisMatch,
} from "../../../lib/supabase";
import { addToWatchlist, watchlistErrorMessage } from "../../../lib/watchlist";
import { cleanNarrative } from "../../../../lib/enrichment/narrative";
import { EmptyState, ErrorLine, Spinner } from "./AlphaBits";
import type { AlphaData } from "./useAlphaData";
import { useAlphaT } from "./useAlphaT";

const CALIBRATED_AT = 3;

export function MatchesTab({ data }: { data: AlphaData }) {
  const tt = useAlphaT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signals, setSignals] = useState(0);
  const [matches, setMatches] = useState<ThesisMatch[]>([]);
  const [rows, setRows] = useState<StartupListRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPreferenceSignalCount(), fetchTopThesisMatches(24, 14)])
      .then(async ([count, m]) => {
        const r = m.length ? await fetchStartupsByIds(m.map((x) => x.startup_id)) : [];
        if (cancelled) return;
        setSignals(count); setMatches(m); setRows(r);
      })
      .catch((e) => { if (!cancelled) setError(watchlistErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const ordered = useMemo(() => matches.map((m) => ({ m, s: rows.find((r) => r.id === m.startup_id) })).filter((x): x is { m: ThesisMatch; s: StartupListRow } => !!x.s), [matches, rows]);

  async function decide(id: string, kind: "track" | "pass") {
    setBusy(id); setProblem(null);
    try {
      if (kind === "track") { await addToWatchlist("startup", id); data.reload(); }
      else await logInteraction({ startup_id: id, action_type: "pass" });
      setMatches((all) => all.filter((x) => x.startup_id !== id));
    } catch (e) { setProblem(watchlistErrorMessage(e)); } finally { setBusy(null); }
  }

  if (loading) return <Spinner label={tt("loading", "Loading")} />;
  if (error) return <ErrorLine message={error} />;
  if (signals < CALIBRATED_AT) {
    return <EmptyState icon={<Sparkles className="w-8 h-8" />} title={tt("calTitle", "Still calibrating")}
      body={tt("calBody", "Follow or pass on a few companies and AlphaMap learns what fits. {{count}} of {{need}} so far.", { count: signals, need: CALIBRATED_AT })}
      action={<Link to="/startups" className="h-9 inline-flex items-center px-4 rounded-am-ctl bg-am-ink text-white text-am-body font-semibold hover:bg-slate-800">{tt("browse", "Browse companies")}</Link>} />;
  }
  if (ordered.length === 0) {
    return <EmptyState icon={<Sparkles className="w-8 h-8" />} title={tt("noMatchTitle", "No new matches right now")} body={tt("noMatchBody", "New companies that fit your thesis appear here as they are added.")} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-am-body text-am-ink-3">{tt("matchesBlurb", "Companies that fit what you follow and pass on. Following one adds it to your Watchlist; passing hides it for good.")}</p>
      {problem && <ErrorLine message={problem} />}
      <div className="grid gap-3.5 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
        {ordered.map(({ m, s }) => {
          const where = [s.city, s.country].filter(Boolean).join(", ");
          const desc = cleanNarrative(s.description);
          return (
            <article key={s.id} className="bg-am-surface border border-am-line rounded-am-card shadow-am-1 p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <CompanyLogo name={s.name} website={s.website} size={36} rounded="rounded-[10px]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={`/startups?company=${s.id}`} className="text-am-title font-semibold text-am-ink truncate hover:text-am-accent">{s.name}</Link>
                    {m.is_new && <span className="flex-none inline-flex items-center h-5 px-2 rounded-full bg-[#E7F6EF] text-am-pos text-[11px] font-semibold">{tt("new", "New")}</span>}
                  </div>
                  <p className="text-am-caption text-am-ink-3 truncate">{[s.sector_parent || s.industry, where].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                <span className="text-am-kpi font-bold tabular-nums text-am-pos">{Math.round(m.match_pct)}%</span>
              </div>
              {desc && <p className="text-am-body text-am-ink-2 leading-relaxed line-clamp-3">{desc}</p>}
              <div className="mt-auto flex gap-2">
                <button type="button" disabled={busy === s.id} onClick={() => decide(s.id, "pass")}
                  className="h-9 flex-1 rounded-am-ctl border border-am-line bg-am-surface text-am-body font-medium text-am-ink hover:bg-am-canvas disabled:opacity-50">{tt("pass", "Pass")}</button>
                <button type="button" disabled={busy === s.id} onClick={() => decide(s.id, "track")}
                  className="h-9 flex-1 rounded-am-ctl bg-am-ink border border-am-ink text-white text-am-body font-semibold hover:bg-slate-800 disabled:opacity-50">{tt("follow", "Follow")}</button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
