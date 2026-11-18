import React from "react";
import { Loader2, Star } from "lucide-react";
import { soldPercent, type FundFiling, type VcFirm, type VcSort, type VcSortKey } from "../../../lib/vcFirms";
import { isOpenOffering } from "../../../lib/vcFirms";
import { CompanyLogo } from "../CompanyLogo";
import { useVcT } from "./useVcT";

function monthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function focusText(f: VcFirm): string {
  const total = f.sectors.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return "";
  return f.sectors.slice(0, 2).map((x) => `${x.sector} ${Math.round((x.weight / total) * 100)}%`).join(" · ");
}

const Dash = () => <span className="text-am-ink-3">—</span>;

export function VcsTable({
  firms, total, sort, onSort, activeId, onSelect, isFollowing, onToggleFollow, filings, narrow, loading, hasMore, onLoadMore,
}: {
  firms: VcFirm[];
  total: number;
  sort: VcSort | null;
  onSort: (key: VcSortKey) => void;
  activeId: string | null;
  onSelect: (f: VcFirm) => void;
  isFollowing: (f: VcFirm) => boolean;
  onToggleFollow: (f: VcFirm) => void;
  filings: ReadonlyMap<string, FundFiling[]>;
  /** A firm card is open beside the table: keep only what identifies a firm. */
  narrow: boolean;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const tt = useVcT();
  const cols: { id: string; label: string; sortKey?: VcSortKey; numeric?: boolean; hide?: boolean }[] = [
    { id: "firm", label: tt("colFirm", "Firm"), sortKey: "name" },
    { id: "stages", label: tt("colStages", "Stages"), hide: narrow },
    { id: "focus", label: tt("colFocus", "Focus"), hide: narrow },
    { id: "check", label: tt("colCheck", "Typical check"), sortKey: "check", numeric: true, hide: narrow },
    { id: "fund", label: tt("colFund", "Fund size"), sortKey: "fundSize", numeric: true },
    { id: "portfolio", label: tt("colPortfolio", "Portfolio"), sortKey: "portfolio", numeric: true, hide: narrow },
    { id: "filing", label: tt("colFiling", "Latest fund filing"), hide: narrow },
  ];
  const shown = cols.filter((c) => !c.hide);
  const now = Date.now();

  return (
    <div className="relative bg-am-surface border border-am-line rounded-am-card shadow-am-1 h-full flex flex-col">
      <div className="overflow-auto rounded-am-card flex-1 min-h-0">
        <table className={`w-full ${narrow ? "min-w-[440px]" : "min-w-[1000px]"} table-fixed border-separate border-spacing-0 text-am-body text-am-ink`}>
          <colgroup>
            <col />
            {!narrow && <col style={{ width: 130 }} />}
            {!narrow && <col style={{ width: 200 }} />}
            {!narrow && <col style={{ width: 120 }} />}
            <col style={{ width: narrow ? 110 : 100 }} />
            {!narrow && <col style={{ width: 96 }} />}
            {!narrow && <col style={{ width: 190 }} />}
            <col style={{ width: 52 }} />
          </colgroup>
          <thead>
            <tr>
              {shown.map((c) => {
                const active = sort?.key === c.sortKey;
                return (
                  <th key={c.id} scope="col" aria-sort={c.sortKey ? (active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    className={`sticky top-0 z-10 bg-am-surface border-b border-am-line px-3.5 h-10 text-am-caption whitespace-nowrap ${c.numeric ? "text-end" : "text-start"} ${active ? "text-am-ink font-semibold" : "text-am-ink-3 font-medium"}`}>
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
              <th className="sticky top-0 z-10 bg-am-surface border-b border-am-line" scope="col"><span className="sr-only">{tt("follow", "Follow")}</span></th>
            </tr>
          </thead>
          <tbody>
            {firms.map((f) => {
              const list = filings.get(f.id) ?? [];
              const latest = list[0];
              const open = list.some((x) => isOpenOffering(x, now));
              const pct = latest ? soldPercent(latest) : null;
              const following = isFollowing(f);
              const active = activeId === f.id;
              const cell = "px-3.5 py-3 border-b border-am-line-soft";
              const focus = focusText(f);
              return (
                <tr key={f.id} onClick={() => onSelect(f)} tabIndex={0} aria-current={active ? "true" : undefined}
                  onKeyDown={(e) => { if (e.key === "Enter") onSelect(f); }}
                  className={`cursor-pointer transition-colors focus:outline-none focus-visible:bg-am-canvas ${active ? "bg-am-canvas shadow-[inset_3px_0_0_var(--am-accent)]" : "hover:bg-am-canvas"}`}>
                  <td className={cell}>
                    <div className="flex items-center gap-3 min-w-0">
                      <CompanyLogo name={f.name} website={f.website} size={32} rounded="rounded-lg" />
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{f.name}</div>
                        <div className="text-am-caption text-am-ink-3 truncate">{[f.hq, f.foundedYear ? `est. ${f.foundedYear}` : null].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                    </div>
                  </td>
                  {!narrow && <td className={`${cell} text-am-ink-2 overflow-hidden text-ellipsis whitespace-nowrap`}>{f.stages.length ? `${f.stages.slice(0, 2).join(", ")}${f.stages.length > 2 ? ` +${f.stages.length - 2}` : ""}` : <Dash />}</td>}
                  {!narrow && <td className={`${cell} text-am-ink-2 overflow-hidden text-ellipsis whitespace-nowrap`} title={focus}>{focus || <Dash />}</td>}
                  {!narrow && <td className={`${cell} text-end tabular-nums whitespace-nowrap font-medium`}>{f.checkLabel ?? <Dash />}</td>}
                  <td className={`${cell} text-end tabular-nums whitespace-nowrap font-medium`}>{f.fundSizeLabel ?? <Dash />}</td>
                  {!narrow && <td className={`${cell} text-end tabular-nums whitespace-nowrap font-medium`}>{f.portfolio != null ? f.portfolio.toLocaleString() : <Dash />}</td>}
                  {!narrow && (
                    <td className={cell}>
                      {latest ? (
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate font-medium">{latest.name}</span>
                            {open && <span className="flex-none px-2 py-0.5 rounded-full bg-am-accent-soft text-am-accent text-[11px] font-medium">{tt("open", "Open")}</span>}
                          </div>
                          <div className="text-am-caption text-am-ink-3 tabular-nums">{monthYear(latest.filedOn)}{pct != null ? ` · ${pct}% sold` : ""}</div>
                        </div>
                      ) : <Dash />}
                    </td>
                  )}
                  <td className={`${cell} text-end`}>
                    <button type="button" aria-pressed={following} onClick={(e) => { e.stopPropagation(); onToggleFollow(f); }}
                      aria-label={following ? tt("unfollowFirm", "Stop following {{name}}", { name: f.name }) : tt("followFirmNamed", "Follow {{name}}", { name: f.name })}
                      className="grid place-items-center w-9 h-9 rounded-lg text-am-ink-3 hover:bg-am-surface hover:text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40">
                      <Star className={`w-4 h-4 ${following ? "fill-am-star text-am-star" : ""}`} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-am-ink-3" aria-label={tt("loading", "Loading")} /></div>}
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-am-caption text-am-ink-3 border-t border-am-line-soft">
          <span className="tabular-nums">{tt("showingOf", "Showing {{shown}} of {{total}}", { shown: firms.length.toLocaleString(), total: total.toLocaleString() })}</span>
          {hasMore && (
            <button type="button" onClick={onLoadMore}
              className="h-8 px-3 rounded-am-ctl border border-am-line bg-am-surface text-am-body font-medium text-am-ink hover:bg-am-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40">
              {tt("loadMore", "Load more")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
