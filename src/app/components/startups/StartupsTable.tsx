import React from "react";
import { useTranslation } from "react-i18next";
import { GitCompare, Star, X, XCircle, Loader2 } from "lucide-react";
import type { MatchScoreResult, StartupListRow } from "../../../lib/supabase";
import { roundTypeLabel } from "../../../lib/taxonomy";
import {
  daysSince, formatUsdShort, freshnessLabel, isStale, trendView,
  type StartupSort, type StartupSortKey,
} from "../../../lib/startupFilters";
import { CompanyLogo } from "../CompanyLogo";
import { useV2T } from "./filterTypes";

const PLACEHOLDER_RE = /^(unknown|n\/a|none|-|—)$/i;
function place(city: string | null, country: string | null): string {
  return [city, country].filter((p): p is string => !!p && !PLACEHOLDER_RE.test(p)).join(", ") || "—";
}

interface Column {
  id: string;
  label: string;
  sortKey?: StartupSortKey;
  numeric?: boolean;
  className?: string;
}

export function StartupsTable({
  rows, sort, onSort, density, selectedIds, onToggleSelect, onSelect, isSaved, onSave, onPass, matchScores, loading,
}: {
  rows: StartupListRow[];
  sort: StartupSort | null;
  onSort: (key: StartupSortKey) => void;
  density: "comfortable" | "compact";
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (row: StartupListRow, e: React.MouseEvent) => void;
  onSelect: (row: StartupListRow) => void;
  isSaved: (row: StartupListRow) => boolean;
  onSave: (row: StartupListRow) => void;
  onPass: (row: StartupListRow) => void;
  matchScores: ReadonlyMap<string, MatchScoreResult>;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const tt = useV2T();
  const compact = density === "compact";
  const cols: Column[] = [
    { id: "company", label: tt("colCompany", "Company"), sortKey: "name" },
    { id: "stage", label: tt("colStage", "Stage") },
    { id: "hq", label: tt("colHq", "HQ") },
    { id: "valuation", label: tt("colValuation", "Valuation"), sortKey: "latest_valuation", numeric: true },
    { id: "raised", label: tt("colRaised", "Raised"), sortKey: "total_raised", numeric: true },
    { id: "headcount", label: tt("colHeadcount", "Headcount"), sortKey: "employee_count", numeric: true },
    { id: "match", label: tt("colMatch", "Match"), numeric: true },
    { id: "updated", label: tt("colUpdated", "Updated"), sortKey: "updated_at", numeric: true },
  ];
  const now = Date.now();
  const cell = `px-3.5 ${compact ? "py-1.5" : "py-3"}`;

  return (
    <div className={`relative bg-am-surface border border-am-line rounded-am-card shadow-am-1 transition-opacity ${loading ? "opacity-60" : ""}`}>
      {loading && <Loader2 className="absolute top-3 end-3 w-4 h-4 text-am-ink-3 animate-spin z-20" aria-label={tt("loading", "Loading")} />}
      <div className="overflow-auto max-h-[calc(100vh-17rem)] rounded-am-card">
        <table className="w-full min-w-[920px] border-separate border-spacing-0 text-am-body text-am-ink">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 bg-am-surface border-b border-am-line w-10 ps-4" scope="col"><span className="sr-only">{tt("select", "Select")}</span></th>
              {cols.map((c) => {
                const active = sort?.key === c.sortKey;
                return (
                  <th key={c.id} scope="col"
                    aria-sort={c.sortKey ? (active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    className={`sticky top-0 z-10 bg-am-surface border-b border-am-line px-3.5 h-10 text-am-caption font-medium whitespace-nowrap ${c.numeric ? "text-end" : "text-start"} ${active ? "text-am-ink font-semibold" : "text-am-ink-3"}`}>
                    {c.sortKey ? (
                      <button type="button" onClick={() => onSort(c.sortKey!)}
                        className={`inline-flex items-center gap-1 text-am-caption ${active ? "font-semibold" : "font-medium"} hover:text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 rounded`}>
                        {c.label}
                        <span aria-hidden="true" className={`text-[10px] ${active ? "" : "opacity-40"}`}>{active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
              <th className="sticky top-0 z-10 bg-am-surface border-b border-am-line w-24" scope="col"><span className="sr-only">{tt("actions", "Actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const selected = selectedIds.has(r.id);
              const saved = isSaved(r);
              const days = daysSince(r.updated_at, now);
              const trend = trendView(r.growth_trend);
              const m = matchScores.get(r.id);
              return (
                <tr key={r.id} data-tour={idx === 0 ? "company-results" : undefined} onClick={() => onSelect(r)} aria-selected={selected}
                  className={`group cursor-pointer border-b border-am-line-soft transition-colors ${selected ? "bg-am-accent-soft" : "hover:bg-am-canvas"}`}>
                  <td className={`${cell} ps-4 w-10 border-b border-am-line-soft`}>
                    <button type="button" role="checkbox" aria-checked={selected} aria-label={tt("selectCompany", "Select {{name}} for comparison", { name: r.name })}
                      onClick={(e) => onToggleSelect(r, e)}
                      className={`grid place-items-center w-[18px] h-[18px] rounded-[5px] border-[1.5px] text-[11px] leading-none text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 ${selected ? "bg-am-accent border-am-accent" : "bg-am-surface border-slate-300 hover:border-am-ink-3"}`}>
                      {selected ? "✓" : ""}
                    </button>
                  </td>
                  <td className={`${cell} border-b border-am-line-soft`}>
                    <div className="flex items-center gap-3 min-w-[220px]">
                      <CompanyLogo name={r.name} website={r.website} size={compact ? 24 : 32} rounded="rounded-lg" />
                      <div className="min-w-0">
                        <div className="font-semibold leading-tight truncate max-w-[260px]">{r.name}</div>
                        {!compact && r.industry && <div className="text-am-caption text-am-ink-3 truncate max-w-[260px]">{r.industry}</div>}
                      </div>
                    </div>
                  </td>
                  <td className={`${cell} border-b border-am-line-soft whitespace-nowrap`}>
                    {r.latest_round_type
                      ? <span className="inline-block px-2.5 py-0.5 rounded-full border border-am-line bg-am-canvas text-am-caption font-medium text-am-ink-2">{roundTypeLabel(r.latest_round_type)}</span>
                      : <span className="text-am-ink-3">—</span>}
                  </td>
                  <td className={`${cell} border-b border-am-line-soft text-am-ink-2 whitespace-nowrap`}>{place(r.city, r.country)}</td>
                  <td className={`${cell} border-b border-am-line-soft text-end tabular-nums whitespace-nowrap`}>
                    {r.latest_valuation
                      ? <>{formatUsdShort(r.latest_valuation)}{r.latest_round_is_estimated && <span className="ms-1.5 px-1 rounded border border-am-line text-[11px] text-am-ink-3 align-middle" title={tt("estimatedHint", "Estimated, not reported")}>Est.</span>}</>
                      : <span className="text-am-ink-3">—</span>}
                  </td>
                  <td className={`${cell} border-b border-am-line-soft text-end tabular-nums whitespace-nowrap`}>
                    {r.total_raised ? formatUsdShort(r.total_raised) : <span className="text-am-ink-3">—</span>}
                  </td>
                  <td className={`${cell} border-b border-am-line-soft text-end tabular-nums whitespace-nowrap`}>
                    {r.employee_count != null ? r.employee_count.toLocaleString() : <span className="text-am-ink-3">—</span>}
                    {trend.tone !== "none" && (
                      <span className={`ms-2 text-am-caption ${trend.tone === "pos" ? "text-am-pos" : trend.tone === "neg" ? "text-am-neg" : "text-am-ink-3"}`}>
                        {trend.arrow} {trend.label}
                      </span>
                    )}
                  </td>
                  <td className={`${cell} border-b border-am-line-soft text-end tabular-nums whitespace-nowrap`}>
                    {m ? (
                      <span className="inline-flex items-center justify-end gap-2" title={t("startups.matchHint", { defaultValue: "Match to your mandate" })}>
                        <span className="w-11 h-1 rounded-full bg-am-line" aria-hidden="true"><span className="block h-1 rounded-full bg-am-ink" style={{ width: `${Math.max(0, Math.min(100, m.match_pct))}%` }} /></span>
                        <span className="font-semibold min-w-[24px]">{Math.round(m.match_pct)}</span>
                      </span>
                    ) : <span className="text-am-ink-3 text-am-caption" title={t("startups.calibrating")}>—</span>}
                  </td>
                  <td className={`${cell} border-b border-am-line-soft text-end tabular-nums whitespace-nowrap text-am-caption ${isStale(days) ? "text-am-warn font-medium" : "text-am-ink-3"}`}>
                    {freshnessLabel(days)}
                  </td>
                  <td className={`${cell} pe-3 border-b border-am-line-soft`}>
                    <div className="flex items-center justify-end gap-0.5">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onSave(r); }} aria-pressed={saved}
                        aria-label={saved ? tt("unsave", "Remove {{name}} from watchlist", { name: r.name }) : tt("save", "Save {{name}} to watchlist", { name: r.name })}
                        className="grid place-items-center w-9 h-9 rounded-lg text-am-ink-3 hover:bg-am-canvas hover:text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40">
                        <Star className={`w-4 h-4 ${saved ? "fill-am-star text-am-star" : ""}`} aria-hidden="true" />
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); onPass(r); }}
                        aria-label={tt("pass", "Pass on {{name}}", { name: r.name })}
                        className="grid place-items-center w-9 h-9 rounded-lg text-am-ink-3 hover:bg-am-canvas hover:text-am-neg focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40">
                        <XCircle className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Replaces the dark floating buttons: appears at the bottom once anything is ticked. */
export function SelectionBar({ count, singleSaved, busy, error, onClear, onWatch, onCompare }: {
  count: number;
  /** Only meaningful when exactly one company is selected. */
  singleSaved: boolean;
  busy: boolean;
  error: string | null;
  onClear: () => void;
  onWatch: () => void;
  onCompare: () => void;
}) {
  const tt = useV2T();
  if (count === 0) return null;
  const canCompare = count >= 2;
  return (
    <div className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 pointer-events-none">
      <div role="region" aria-label={tt("selection", "Selection")}
        className="pointer-events-auto flex flex-wrap items-center gap-2 ps-4 pe-2 py-2 rounded-am-card border border-am-line bg-am-surface shadow-am-2 text-am-body text-am-ink">
        <span className="font-semibold tabular-nums">{tt("selected", "{{count}} selected", { count })}</span>
        {error && <span className="text-am-caption text-am-neg max-w-[240px]">{error}</span>}
        <span className="w-px h-5 bg-am-line mx-1" aria-hidden="true" />
        <button type="button" onClick={onClear} className="h-9 px-3 rounded-am-ctl text-am-ink-3 hover:text-am-ink font-medium inline-flex items-center gap-1.5">
          <X className="w-3.5 h-3.5" aria-hidden="true" />{tt("clear", "Clear")}
        </button>
        {count === 1 && (
          <button type="button" onClick={onWatch} disabled={busy}
            className="h-9 px-3.5 rounded-am-ctl border border-am-line bg-am-surface font-semibold hover:bg-am-canvas disabled:opacity-60 inline-flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {singleSaved ? tt("removeFromWatchlist", "Remove from watchlist") : tt("addToWatchlist", "Add to watchlist")}
          </button>
        )}
        <button type="button" onClick={onCompare} disabled={!canCompare}
          className="h-9 px-4 rounded-am-ctl bg-am-ink text-white font-semibold hover:bg-slate-800 disabled:bg-am-line disabled:text-am-ink-3 disabled:cursor-default inline-flex items-center gap-1.5">
          <GitCompare className="w-4 h-4" aria-hidden="true" />
          {canCompare ? tt("compareN", "Compare ({{count}})", { count }) : tt("selectMore", "Select {{count}} more", { count: 2 - count })}
        </button>
      </div>
    </div>
  );
}
