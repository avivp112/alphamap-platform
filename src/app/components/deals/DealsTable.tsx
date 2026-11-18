import React from "react";
import { ExternalLink, Loader2, Star } from "lucide-react";
import { fmtUsd, soldPct, type DealFeedRow, type DealKind, type DealSort } from "../../../lib/dealFeed";
import { useDealsT } from "./useDealsT";

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function ago(iso: string, now: number): string {
  const diff = Math.floor((now - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
  if (Number.isNaN(diff)) return "";
  if (diff <= 0) return "Today";
  if (diff < 14) return `${diff}d ago`;
  if (diff < 60) return `${Math.floor(diff / 7)}w ago`;
  return `${Math.floor(diff / 30)}mo ago`;
}

function initials(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}
const AVATAR_BG = ["#0F172A", "#334155", "#1E293B", "#475569"];
function avatarBg(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_BG[h % AVATAR_BG.length];
}

export function DealsTable({
  rows, kind, sort, ascending, onSort, activeId, onSelect, isNew, isFollowing, narrow, loading, total, hasMore, onLoadMore,
}: {
  rows: DealFeedRow[];
  kind: DealKind;
  sort: DealSort;
  ascending: boolean;
  onSort: (col: DealSort) => void;
  activeId: string | null;
  onSelect: (row: DealFeedRow) => void;
  isNew: (row: DealFeedRow) => boolean;
  isFollowing: (row: DealFeedRow) => boolean;
  /** A deal card is open beside the table: keep only what identifies a deal. */
  narrow: boolean;
  loading: boolean;
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const tt = useDealsT();
  const now = Date.now();
  const isFund = kind === "fund";
  const cols: { id: string; label: string; sortKey?: DealSort; numeric?: boolean; hide?: boolean }[] = [
    { id: "filed", label: tt("colFiled", "Filed"), sortKey: "deal_date" },
    { id: "name", label: isFund ? tt("colFund", "Fund") : tt("colCompany", "Company") },
    { id: "sector", label: isFund ? tt("colFirm", "Firm") : tt("colSector", "Sector"), hide: narrow },
    { id: "sold", label: tt("colSold", "Sold"), sortKey: "amount_raised", numeric: true },
    { id: "offering", label: tt("colOffering", "Offering"), sortKey: "target_amount", hide: narrow },
    { id: "status", label: isFund ? tt("colFirmStatus", "Firm") : tt("colStatus", "Status") },
  ];
  const shown = cols.filter((c) => !c.hide);

  return (
    <div className={`relative bg-am-surface border border-am-line rounded-am-card shadow-am-1 h-full flex flex-col transition-opacity ${loading && rows.length > 0 ? "opacity-70" : ""}`}>
      <div className="overflow-auto rounded-am-card flex-1 min-h-0">
        <table className={`w-full ${narrow ? "min-w-[460px]" : "min-w-[980px]"} table-fixed border-separate border-spacing-0 text-am-body text-am-ink`}>
          <colgroup>
            <col style={{ width: 104 }} />
            <col />
            {!narrow && <col style={{ width: 190 }} />}
            <col style={{ width: 96 }} />
            {!narrow && <col style={{ width: 210 }} />}
            <col style={{ width: 120 }} />
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              {shown.map((c) => {
                const active = c.sortKey === sort;
                return (
                  <th key={c.id} scope="col" aria-sort={c.sortKey ? (active ? (ascending ? "ascending" : "descending") : "none") : undefined}
                    className={`sticky top-0 z-10 bg-am-surface border-b border-am-line px-3.5 h-10 text-am-caption whitespace-nowrap ${c.numeric ? "text-end" : "text-start"} ${active ? "text-am-ink font-semibold" : "text-am-ink-3 font-medium"}`}>
                    {c.sortKey ? (
                      <button type="button" onClick={() => onSort(c.sortKey!)}
                        className={`inline-flex items-center gap-1 text-am-caption ${active ? "font-semibold" : "font-medium"} hover:text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 rounded`}>
                        {c.label}
                        <span aria-hidden="true" className={`text-[10px] ${active ? "" : "opacity-40"}`}>{active ? (ascending ? "▲" : "▼") : "↕"}</span>
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
              <th className="sticky top-0 z-10 bg-am-surface border-b border-am-line" scope="col"><span className="sr-only">{tt("filing", "Filing")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = soldPct(r);
              const fresh = isNew(r);
              const follow = isFollowing(r);
              const active = activeId === r.id;
              const cell = "px-3.5 py-2.5 border-b border-am-line-soft";
              return (
                <tr key={r.id} onClick={() => onSelect(r)} tabIndex={0} aria-current={active ? "true" : undefined}
                  onKeyDown={(e) => { if (e.key === "Enter") onSelect(r); }}
                  className={`group cursor-pointer transition-colors focus:outline-none focus-visible:bg-am-canvas ${active ? "bg-am-canvas shadow-[inset_3px_0_0_var(--am-accent)]" : "hover:bg-am-canvas"}`}>
                  <td className={cell}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-none ${fresh ? "bg-am-accent" : "bg-transparent"}`} title={fresh ? tt("newFiling", "New since your last visit") : undefined} aria-label={fresh ? tt("newFiling", "New since your last visit") : undefined} />
                      <div>
                        <div className="font-medium tabular-nums">{fmtDate(r.deal_date)}</div>
                        <div className="text-am-caption text-am-ink-3">{ago(r.deal_date, now)}</div>
                      </div>
                    </div>
                  </td>
                  <td className={cell}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-none grid place-items-center w-8 h-8 rounded-lg text-white text-am-caption font-semibold" style={{ background: avatarBg(r.name) }}>{initials(r.name)}</div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold truncate">{r.name}</span>
                          {follow && (
                            <span className="inline-flex items-center gap-1 flex-none px-2 py-0.5 rounded-full bg-am-accent-soft text-am-accent text-[11px] font-medium">
                              <Star className="w-3 h-3 fill-am-star text-am-star" aria-hidden="true" />{tt("following", "Following")}
                            </span>
                          )}
                        </div>
                        {narrow && <div className="text-am-caption text-am-ink-3 truncate">{isFund ? r.firm_name ?? "" : r.sector ?? ""}</div>}
                      </div>
                    </div>
                  </td>
                  {!narrow && (
                    <td className={`${cell} text-am-ink-2 overflow-hidden text-ellipsis whitespace-nowrap`}>
                      {isFund ? [r.firm_name, r.fund_series ? `#${r.fund_series}` : null].filter(Boolean).join(" · ") || "—" : r.sector ?? "—"}
                    </td>
                  )}
                  <td className={`${cell} text-end font-semibold tabular-nums whitespace-nowrap`}>{fmtUsd(r.amount_raised)}</td>
                  {!narrow && (
                    <td className={cell}>
                      {pct == null ? <span className="text-am-ink-3">{fmtUsd(r.target_amount)}</span> : (
                        <div className="flex items-center gap-2.5">
                          <span className="w-14 h-1 rounded-full bg-am-line flex-none" aria-hidden="true"><span className="block h-1 rounded-full bg-am-ink" style={{ width: `${pct}%` }} /></span>
                          <span className="text-am-ink-2 tabular-nums whitespace-nowrap">{pct}% of {fmtUsd(r.target_amount)}</span>
                        </div>
                      )}
                    </td>
                  )}
                  <td className={`${cell} whitespace-nowrap text-am-caption font-medium ${r.review_status === "verified" ? "text-am-pos" : "text-am-warn"}`}>
                    {r.review_status === "verified" ? (isFund ? tt("inAlphaMap", "In AlphaMap") : tt("verified", "Verified")) : (isFund ? tt("newFirm", "New firm") : tt("unreviewed", "Not reviewed"))}
                  </td>
                  <td className={`${cell} text-end`}>
                    {r.source_url && (
                      <a href={r.source_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                        aria-label={tt("secFiling", "Open the SEC filing")} title={tt("secFiling", "Open the SEC filing")}
                        className="inline-grid place-items-center w-8 h-8 rounded-lg text-am-ink-3 hover:bg-am-surface hover:text-am-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40">
                        <ExternalLink className="w-4 h-4" aria-hidden="true" />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-am-ink-3" aria-label={tt("loading", "Loading")} /></div>
        )}
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-am-caption text-am-ink-3 border-t border-am-line-soft">
          <span className="tabular-nums">{tt("showingOf", "Showing {{shown}} of {{total}}", { shown: rows.length.toLocaleString(), total: total.toLocaleString() })}</span>
          {hasMore && !loading && (
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
