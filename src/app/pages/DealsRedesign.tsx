import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertCircle, Building2, Search, X } from "lucide-react";
import { Layout } from "../components/Layout";
import { ExportMenu } from "../components/SideFilterLayout";
import { DealDetailModal } from "../components/DealDetailModal";
import { useIsMobile } from "../components/ui/use-mobile";
import { FilterChips } from "../components/startups/FilterBar";
import { DealsFilterBar, type DealFilterActions } from "../components/deals/DealsFilterBar";
import { DealsTable } from "../components/deals/DealsTable";
import { DealPanel } from "../components/deals/DealPanel";
import { useDealsT } from "../components/deals/useDealsT";
import { fetchDealFeed, fetchDealFeedCount, fetchDealFeedForExport, fetchDealFeedStats, type DealFeedFilters } from "../../lib/supabase";
import { exportColumns, fmtUsd, type DealFeedRow, type DealFeedStats, type DealKind, type DealSort } from "../../lib/dealFeed";
import { exportRows, type ExportFormat } from "../../lib/exportData";
import {
  EMPTY_DEAL_FILTERS, activeDealFilterCount, buildDealChips, followTarget, followedIds, isNewDeal,
  readSeenThrough, writeSeenThrough, type DealFilterState,
} from "../../lib/dealFilters";
import { EMPTY_RANGE } from "../../lib/startupFilters";
import { addToWatchlist, removeFromWatchlist, useWatchlistMembership, watchlistErrorMessage } from "../../lib/watchlist";

// ─────────────────────────────────────────────────────────────────────────────
// Deal Flow, redesigned (?ui=2). The same deal_feed as the page it replaces — nothing here is
// made up — shown the way the Private Market page is: filters in a bar, a table that fills the
// screen, and the selected deal in a column beside it.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 50;

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-5 py-3 min-w-0 border-e border-am-line-soft last:border-e-0">
      <div className="text-am-caption text-am-ink-3">{label}</div>
      <div className="text-am-kpi font-semibold text-am-ink tracking-tight tabular-nums truncate">{value}</div>
      {sub && <div className="text-am-caption text-am-ink-3 truncate">{sub}</div>}
    </div>
  );
}

export function DealsRedesign() {
  const { t } = useTranslation();
  const tt = useDealsT();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const workspace = !isMobile;

  const [kind, setKind] = useState<DealKind>("company");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<DealSort>("deal_date");
  const [ascending, setAscending] = useState(false);
  const [filters, setFilters] = useState<DealFilterState>(EMPTY_DEAL_FILTERS);
  const [rows, setRows] = useState<DealFeedRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DealFeedStats | null>(null);
  const [selected, setSelected] = useState<DealFeedRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Watchlist: which deals belong to something the user follows.
  const watchlist = useWatchlistMembership();
  const followType = kind === "fund" ? "investor" : "startup";
  const followKey = followedIds(watchlist.ids, followType).sort().join(",");
  const followed = useMemo(() => (followKey ? followKey.split(",") : []), [followKey]);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // The query the list shows; anything that changes it starts the list again.
  const feedFilters: DealFeedFilters = useMemo(() => ({
    sectors: filters.sectors.length ? filters.sectors : undefined,
    filedWithinDays: filters.filedWithinDays ?? undefined,
    soldMin: filters.sold.min ?? undefined,
    soldMax: filters.sold.max ?? undefined,
    status: filters.status === "all" ? undefined : filters.status,
    followIds: filters.followingOnly ? followed : undefined,
  }), [filters, followed]);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDealFeed({ kind, search: debounced, sort, ascending, limit: PAGE, offset, ...feedFilters });
      setRows((prev) => (offset === 0 ? res.rows : [...prev, ...res.rows]));
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (offset === 0) { setRows([]); setTotal(0); }
    } finally {
      setLoading(false);
    }
  }, [kind, debounced, sort, ascending, feedFilters]);
  useEffect(() => { void load(0); }, [load]);

  // Headline numbers over the whole feed of this kind.
  useEffect(() => {
    let cancelled = false;
    setStats(null);
    fetchDealFeedStats(kind).then((s) => { if (!cancelled) setStats(s); }).catch(() => { /* optional */ });
    return () => { cancelled = true; };
  }, [kind]);

  // ── New since the last visit ──
  const [seenThrough, setSeenThrough] = useState<string | null>(() => readSeenThrough("company"));
  const [newCount, setNewCount] = useState(0);
  const [newFollowCount, setNewFollowCount] = useState(0);
  useEffect(() => { setSeenThrough(readSeenThrough(kind)); setNewCount(0); setNewFollowCount(0); }, [kind]);
  useEffect(() => {
    // First visit: remember how far the feed goes, so only later filings count as new.
    if (stats?.latest_date && readSeenThrough(kind) == null) { writeSeenThrough(kind, stats.latest_date); setSeenThrough(stats.latest_date); }
  }, [stats?.latest_date, kind]);
  useEffect(() => {
    if (!seenThrough) return;
    let cancelled = false;
    fetchDealFeedCount({ kind, filedAfter: seenThrough }).then((n) => { if (!cancelled) setNewCount(n); }).catch(() => {});
    if (followed.length > 0) {
      fetchDealFeedCount({ kind, filedAfter: seenThrough, followIds: followed }).then((n) => { if (!cancelled) setNewFollowCount(n); }).catch(() => {});
    } else setNewFollowCount(0);
    return () => { cancelled = true; };
  }, [kind, seenThrough, followed]);
  const latestRef = useRef<{ kind: DealKind; date: string | null }>({ kind, date: null });
  latestRef.current = { kind, date: stats?.latest_date ?? null };
  // Leaving the page counts as having seen everything on it.
  useEffect(() => () => { const { kind: k, date } = latestRef.current; if (date) writeSeenThrough(k, date); }, []);
  function markSeen() {
    if (!stats?.latest_date) return;
    writeSeenThrough(kind, stats.latest_date);
    setSeenThrough(stats.latest_date); setNewCount(0); setNewFollowCount(0);
  }

  // ── Actions ──
  const actions: DealFilterActions = {
    setSectors: (v) => setFilters((f) => ({ ...f, sectors: v })),
    setFiled: (v) => setFilters((f) => ({ ...f, filedWithinDays: v })),
    setSold: (v) => setFilters((f) => ({ ...f, sold: v })),
    setStatus: (v) => setFilters((f) => ({ ...f, status: v })),
    setFollowing: (v) => setFilters((f) => ({ ...f, followingOnly: v })),
    clearOne: (id) => setFilters((f) => {
      switch (id) {
        case "sectors": return { ...f, sectors: [] };
        case "filed": return { ...f, filedWithinDays: null };
        case "sold": return { ...f, sold: EMPTY_RANGE };
        case "status": return { ...f, status: "all" };
        case "following": return { ...f, followingOnly: false };
        default: return f;
      }
    }),
    clearAll: () => { setFilters(EMPTY_DEAL_FILTERS); setSearch(""); },
  };
  const chips = buildDealChips(filters, (key, vars, fallback) => t(`deals.v2.${key}`, { defaultValue: fallback, ...vars }) as string);
  const activeCount = activeDealFilterCount(filters);

  function handleSort(col: DealSort) {
    if (col === sort) setAscending((a) => !a);
    else { setSort(col); setAscending(false); }
  }
  function switchKind(k: DealKind) {
    if (k === kind) return;
    setKind(k); setSelected(null); setFilters(EMPTY_DEAL_FILTERS); setSearch("");
  }

  async function handleExport(format: ExportFormat) {
    setExporting(true); setExportError(null);
    try {
      const all = await fetchDealFeedForExport({ kind, search: debounced, sort, ascending, ...feedFilters });
      exportRows(all, exportColumns(kind), kind === "fund" ? "alphamap-vc-fund-raises" : "alphamap-deals", format);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : t("common.exportFailed"));
    } finally { setExporting(false); }
  }

  const isFollowing = (row: DealFeedRow) => { const f = followTarget(row); return !!f && watchlist.has(f.type, f.id); };
  async function toggleFollow() {
    const f = selected && followTarget(selected);
    if (!f) return;
    setFollowBusy(true); setFollowError(null);
    try {
      if (watchlist.has(f.type, f.id)) await removeFromWatchlist(f.type, f.id);
      else await addToWatchlist(f.type, f.id);
      watchlist.refresh();
    } catch (err) {
      if (err instanceof Error && err.message.includes("signed in")) navigate(`/login?next=${encodeURIComponent("/deals")}`);
      else setFollowError(watchlistErrorMessage(err));
    } finally { setFollowBusy(false); }
  }

  const panelOpen = workspace && !!selected;
  useEffect(() => {
    if (!panelOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [panelOpen]);

  const isFund = kind === "fund";
  const hasMore = rows.length < total;
  const emptyFiltered = !loading && !error && rows.length === 0;

  return (
    <Layout>
      <div className={workspace ? "mx-auto w-full max-w-[1760px] h-[calc(100vh-4rem)] flex" : ""}>
        <div className={`${workspace ? "flex-1 min-w-0 min-h-0 flex flex-col" : ""} px-4 sm:px-6 lg:px-8 pt-5 pb-4 gap-3.5 flex flex-col`}>
          {/* Title row */}
          <div className="flex-none flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-baseline gap-3.5 min-w-0 flex-wrap">
              <h1 className="text-am-display font-semibold text-am-ink tracking-tight">{t("deals.title")}</h1>
              {stats?.latest_date && <span className="text-am-body text-am-ink-3">{t("deals.latestFiling", { date: fmtDate(stats.latest_date) })}</span>}
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="relative">
                <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-am-ink-3 pointer-events-none" aria-hidden="true" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t(isFund ? "deals.searchFund" : "deals.searchCompany")}
                  placeholder={t(isFund ? "deals.searchFund" : "deals.searchCompany")}
                  className="w-56 h-9 ps-8 pe-8 rounded-am-ctl border border-am-line bg-am-surface text-am-body text-am-ink placeholder:text-am-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40" />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label={t("common.clear")} className="absolute end-2 top-1/2 -translate-y-1/2 text-am-ink-3 hover:text-am-ink"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
              <div role="group" aria-label={tt("show", "Show")} className="inline-flex bg-am-line-soft rounded-am-ctl p-0.5">
                {(["company", "fund"] as DealKind[]).map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => switchKind(k)}
                    className={`px-3.5 h-8 rounded-[6px] text-am-body font-medium transition-colors ${kind === k ? "bg-am-surface text-am-ink shadow-am-1 font-semibold" : "text-am-ink-3 hover:text-am-ink"}`}>
                    {t(k === "company" ? "deals.tabCompanies" : "deals.tabFunds")}
                  </button>
                ))}
              </div>
              <ExportMenu onExport={handleExport} rowCount={total} exporting={exporting} error={exportError}
                note={total > 5000 ? t("common.exportCapped", { cap: "5,000" }) : undefined} />
            </div>
          </div>

          {/* Headline numbers: hidden while a deal is open, so the list keeps its height */}
          {!panelOpen && (
          <div className="flex-none grid grid-cols-2 lg:grid-cols-4 bg-am-surface border border-am-line rounded-am-card shadow-am-1">
            <Stat label={t("deals.totalSold")} value={stats ? fmtUsd(stats.total_raised) : "…"} sub={stats ? t(isFund ? "deals.fundsCount" : "deals.dealsCount", { count: stats.count }) : undefined} />
            <Stat label={t("deals.largestDeal")} value={stats ? fmtUsd(stats.largest_amount) : "…"} sub={stats?.largest_name ?? undefined} />
            <Stat label={t(isFund ? "deals.mostActiveFirm" : "deals.mostActiveSector")} value={stats?.top_key ?? (stats ? "—" : "…")}
              sub={stats?.top_count ? t(isFund ? "deals.fundsCount" : "deals.dealsCount", { count: stats.top_count }) : undefined} />
            <Stat label={t("deals.newThisMonth")} value={stats ? String(stats.month_count) : "…"}
              sub={stats ? (stats.month_count > 0 ? t("deals.soldThisMonth", { amount: fmtUsd(stats.month_raised) }) : t("deals.noNewDeals")) : undefined} />
          </div>
          )}

          {/* New since the last visit */}
          {newCount > 0 && (
            <div className="flex-none flex flex-wrap items-center justify-between gap-3 rounded-am-card border border-[#D5E0FB] bg-am-accent-soft px-4 py-2.5" role="status">
              <div className="flex items-center gap-3 text-am-body">
                <span className="w-2 h-2 rounded-full bg-am-accent flex-none" aria-hidden="true" />
                <span><b className="font-semibold text-am-ink">{tt("newSince", "{{count}} new filings since your last visit", { count: newCount.toLocaleString() })}</b>
                  {newFollowCount > 0 && <span className="text-am-ink-2"> · {tt("newFollowing", "{{count}} from companies you follow", { count: newFollowCount.toLocaleString() })}</span>}</span>
              </div>
              <button type="button" onClick={markSeen} className="h-8 px-3 rounded-am-ctl border border-[#BCCDF7] bg-am-surface text-am-body font-medium text-am-accent hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40">
                {tt("markSeen", "Mark all as seen")}
              </button>
            </div>
          )}

          <div className="flex-none space-y-2.5">
            <DealsFilterBar kind={kind} state={filters} actions={actions} followingAvailable={followed.length > 0} />
            <FilterChips chips={chips} onClear={actions.clearOne} onClearAll={actions.clearAll} />
            <p className="text-am-caption text-am-ink-3 tabular-nums" aria-live="polite">
              {tt("dealCount", "{{count}} deals", { count: total.toLocaleString() })}{activeCount > 0 || debounced ? ` · ${tt("filtered", "filtered")}` : ""}
            </p>
          </div>

          {(error || followError) && (
            <div className="flex-none flex items-start gap-2 rounded-am-card border border-red-100 bg-red-50 px-4 py-2.5 text-am-body text-am-neg" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /><span className="break-words">{error ?? followError}</span>
            </div>
          )}

          {/* The list */}
          <div className={workspace ? "flex-1 min-h-0" : ""}>
            {emptyFiltered ? (
              <div className="py-16 flex flex-col items-center gap-3 text-center px-6 bg-am-surface border border-am-line rounded-am-card">
                <Building2 className="w-8 h-8 text-am-ink-3" aria-hidden="true" />
                {activeCount > 0 || debounced ? (
                  <>
                    <p className="text-am-title font-medium text-am-ink-2">{t("deals.noDealsMatch")}</p>
                    <button type="button" onClick={actions.clearAll} className="text-am-body font-medium text-am-accent hover:underline">{t("common.clearAllFilters")}</button>
                  </>
                ) : (
                  <>
                    <p className="text-am-title font-semibold text-am-ink-2">{t("deals.emptyTitle")}</p>
                    <p className="text-am-body text-am-ink-3 max-w-md">{t("deals.emptyBody")}</p>
                  </>
                )}
              </div>
            ) : (
              <div className={workspace ? "h-full" : "max-h-[70vh]"}>
                <DealsTable rows={rows} kind={kind} sort={sort} ascending={ascending} onSort={handleSort}
                  activeId={selected?.id ?? null} onSelect={setSelected}
                  isNew={(r) => isNewDeal(r, seenThrough)} isFollowing={isFollowing}
                  narrow={panelOpen} loading={loading} total={total} hasMore={hasMore} onLoadMore={() => void load(rows.length)} />
              </div>
            )}
          </div>
          <p className="flex-none text-am-caption text-am-ink-3 leading-relaxed">{t(isFund ? "deals.fundsFootnote" : "deals.companiesFootnote")}</p>
        </div>

        {panelOpen && selected && (
          <aside aria-label={tt("dealPanel", "Deal")} className="flex-none w-[min(560px,46vw)] h-full py-4 pe-4 lg:pe-8">
            <DealPanel deal={selected} onClose={() => setSelected(null)}
              followable={!!followTarget(selected)} following={isFollowing(selected)} followBusy={followBusy} onToggleFollow={() => void toggleFollow()} />
          </aside>
        )}
      </div>

      {/* Phones: the existing window */}
      {!workspace && selected && <DealDetailModal deal={selected} onClose={() => setSelected(null)} />}
    </Layout>
  );
}
