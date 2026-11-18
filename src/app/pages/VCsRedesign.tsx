import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertCircle, Building2, Loader2, Search, X } from "lucide-react";
import { Layout } from "../components/Layout";
import { ExportMenu } from "../components/SideFilterLayout";
import { useIsMobile } from "../components/ui/use-mobile";
import { FilterChips } from "../components/startups/FilterBar";
import { VcsFilterBar, type VcFilterActions } from "../components/vcs/VcsFilterBar";
import { VcsTable } from "../components/vcs/VcsTable";
import { VcPanel } from "../components/vcs/VcPanel";
import { useVcT } from "../components/vcs/useVcT";
import { fetchInvestors, fetchVcFundFilings, type InvestorRow } from "../../lib/supabase";
import { exportRows, type ExportColumn, type ExportFormat } from "../../lib/exportData";
import { textMatchRank } from "../../lib/searchRank";
import {
  CHECK_BUCKETS, EMPTY_VC_FILTERS, FUND_BUCKETS, activeVcFilterCount, groupFilings, matchesVcFilters, nextVcSort, raisingInvestorIds,
  sectorOptions, sortFirms, stageOptions, toVcFirm, type FundFiling, type VcFilterState, type VcFirm, type VcSort, type VcSortKey,
} from "../../lib/vcFirms";
import { addToWatchlist, removeFromWatchlist, useWatchlistMembership, watchlistErrorMessage } from "../../lib/watchlist";

// ─────────────────────────────────────────────────────────────────────────────
// Venture capital, redesigned (?ui=2). The firms of the investors table and the SEC fund filings
// that belong to them, shown like the Private Market page: filters in a bar, a table that fills the
// screen, the selected firm in a column beside it.
//
// Nothing on this page is estimated. Where the directory has no value the page shows "—" or leaves
// the section out; the old page's "recent investments", "deals per year", dry powder, MOIC and
// co-investor lists were computed from other fields and are not shown here.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 50;
const DEFAULT_SORT: VcSort = { key: "portfolio", dir: "desc" };

const EXPORT_COLUMNS = (filings: ReadonlyMap<string, FundFiling[]>): ExportColumn<VcFirm>[] => [
  { label: "Name", value: (f) => f.name },
  { label: "Headquarters", value: (f) => f.hq ?? "" },
  { label: "Region", value: (f) => f.region ?? "" },
  { label: "Founded", value: (f) => f.foundedYear ?? "" },
  { label: "Fund size", value: (f) => f.fundSizeLabel ?? "" },
  { label: "Fund size (millions USD)", value: (f) => f.fundSizeM ?? "" },
  { label: "Typical check", value: (f) => f.checkLabel ?? "" },
  { label: "Portfolio (reported)", value: (f) => f.portfolio ?? "" },
  { label: "Stages", value: (f) => f.stages.join("; ") },
  { label: "Sectors", value: (f) => f.sectors.map((s) => s.sector).join("; ") },
  { label: "Notable investments", value: (f) => f.notable.join("; ") },
  { label: "Latest SEC fund filing", value: (f) => filings.get(f.id)?.[0]?.name ?? "" },
  { label: "Latest SEC fund filing date", value: (f) => filings.get(f.id)?.[0]?.filedOn ?? "" },
  { label: "Website", value: (f) => f.website ?? "" },
];

export function VCsRedesign() {
  const { t } = useTranslation();
  const tt = useVcT();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const workspace = !isMobile;

  const [rows, setRows] = useState<InvestorRow[]>([]);
  const [filings, setFilings] = useState<ReadonlyMap<string, FundFiling[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<VcFilterState>(EMPTY_VC_FILTERS);
  const [sort, setSort] = useState<VcSort | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const watchlist = useWatchlistMembership();

  useEffect(() => {
    let cancelled = false;
    fetchInvestors()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    // Fund filings are an extra: without them the page still works.
    fetchVcFundFilings().then((f) => { if (!cancelled) setFilings(groupFilings(f)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const firms = useMemo(() => rows.map(toVcFirm), [rows]);
  const updatedAt = useMemo(() => new Map(rows.map((r) => [r.id, r.last_enriched_at ?? r.updated_at ?? null])), [rows]);
  const stages = useMemo(() => stageOptions(firms), [firms]);
  const sectors = useMemo(() => sectorOptions(firms), [firms]);
  const raising = useMemo(() => raisingInvestorIds(filings), [filings]);
  const followed = useMemo(() => new Set(firms.filter((f) => watchlist.has("investor", f.id)).map((f) => f.id)), [firms, watchlist]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = firms.filter((f) => matchesVcFilters(f, filters, { followed, raising }));
    if (q) {
      list = list.filter((f) => f.name.toLowerCase().includes(q) || (f.hq ?? "").toLowerCase().includes(q) || f.sectors.some((s) => s.sector.toLowerCase().includes(q)));
      // A typed search shows the best name match first, whatever the sort says.
      return [...list].sort((a, b) => textMatchRank(a.name, q) - textMatchRank(b.name, q) || a.name.localeCompare(b.name));
    }
    return sortFirms(list, sort ?? DEFAULT_SORT);
  }, [firms, filters, followed, raising, search, sort]);

  useEffect(() => { setShown(PAGE); }, [filters, search, sort]);

  const selected = selectedId ? firms.find((f) => f.id === selectedId) ?? null : null;
  const panelOpen = workspace && !!selected;
  useEffect(() => {
    if (!selected) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected]);

  const actions: VcFilterActions = {
    setStages: (v) => setFilters((f) => ({ ...f, stages: v })),
    setSectors: (v) => setFilters((f) => ({ ...f, sectors: v })),
    setRegions: (v) => setFilters((f) => ({ ...f, regions: v })),
    setCheckIds: (v) => setFilters((f) => ({ ...f, checkIds: v })),
    setFundIds: (v) => setFilters((f) => ({ ...f, fundIds: v })),
    setRaising: (v) => setFilters((f) => ({ ...f, raisingOnly: v })),
    setFollowing: (v) => setFilters((f) => ({ ...f, followingOnly: v })),
    clearOne: (id) => setFilters((f) => {
      switch (id) {
        case "stages": return { ...f, stages: [] };
        case "sectors": return { ...f, sectors: [] };
        case "regions": return { ...f, regions: [] };
        case "check": return { ...f, checkIds: [] };
        case "fund": return { ...f, fundIds: [] };
        case "raising": return { ...f, raisingOnly: false };
        case "following": return { ...f, followingOnly: false };
        default: return f;
      }
    }),
    clearAll: () => { setFilters(EMPTY_VC_FILTERS); setSearch(""); },
  };

  const chips = [
    filters.stages.length ? { id: "stages", label: tt("chipStage", "Stage: {{value}}", { value: filters.stages.join(", ") }) } : null,
    filters.sectors.length ? { id: "sectors", label: tt("chipSector", "Sector: {{value}}", { value: filters.sectors.join(", ") }) } : null,
    filters.regions.length ? { id: "regions", label: tt("chipRegion", "Region: {{value}}", { value: filters.regions.join(", ") }) } : null,
    filters.checkIds.length ? { id: "check", label: tt("chipCheck", "Check: {{value}}", { value: filters.checkIds.map((id) => CHECK_BUCKETS.find((b) => b.id === id)?.label).join(", ") }) } : null,
    filters.fundIds.length ? { id: "fund", label: tt("chipFund", "Fund: {{value}}", { value: filters.fundIds.map((id) => FUND_BUCKETS.find((b) => b.id === id)?.label).join(", ") }) } : null,
    filters.raisingOnly ? { id: "raising", label: tt("raising", "Raising a fund") } : null,
    filters.followingOnly ? { id: "following", label: tt("followingOnly", "Following only") } : null,
  ].filter((c): c is { id: string; label: string } => c !== null);

  const activeCount = activeVcFilterCount(filters);
  const isFollowing = (f: VcFirm) => watchlist.has("investor", f.id);
  async function toggleFollow(f: VcFirm) {
    setFollowBusy(true); setFollowError(null);
    try {
      if (watchlist.has("investor", f.id)) await removeFromWatchlist("investor", f.id);
      else await addToWatchlist("investor", f.id);
      watchlist.refresh();
    } catch (err) {
      if (err instanceof Error && err.message.includes("signed in")) navigate(`/login?next=${encodeURIComponent("/vcs")}`);
      else setFollowError(watchlistErrorMessage(err));
    } finally { setFollowBusy(false); }
  }

  async function handleExport(format: ExportFormat) {
    setExporting(true); setExportError(null);
    try { exportRows(visible, EXPORT_COLUMNS(filings), "alphamap-vc-firms", format); }
    catch (e) { setExportError(e instanceof Error ? e.message : t("common.exportFailed")); }
    finally { setExporting(false); }
  }

  const page = visible.slice(0, shown);
  const empty = !loading && !error && visible.length === 0;

  const panel = selected && (
    <VcPanel firm={selected} filings={filings.get(selected.id) ?? []} recordUpdatedAt={updatedAt.get(selected.id) ?? null}
      onClose={() => setSelectedId(null)} following={isFollowing(selected)} followBusy={followBusy} onToggleFollow={() => void toggleFollow(selected)} />
  );

  return (
    <Layout>
      <div className={workspace ? "mx-auto w-full max-w-[1760px] h-[calc(100vh-4rem)] flex" : ""}>
        <div className={`${workspace ? "flex-1 min-w-0 min-h-0" : ""} px-4 sm:px-6 lg:px-8 pt-5 pb-4 gap-3.5 flex flex-col`}>
          <div className="flex-none flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-baseline gap-3.5 min-w-0 flex-wrap">
              <h1 className="text-am-display font-semibold text-am-ink tracking-tight">{tt("title", "Venture capital")}</h1>
              {!loading && <span className="text-am-body text-am-ink-3 tabular-nums">{tt("firmCount", "{{count}} firms", { count: firms.length.toLocaleString() })}</span>}
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="relative">
                <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-am-ink-3 pointer-events-none" aria-hidden="true" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label={tt("search", "Search firms")} placeholder={tt("search", "Search firms")}
                  className="w-56 h-9 ps-8 pe-8 rounded-am-ctl border border-am-line bg-am-surface text-am-body text-am-ink placeholder:text-am-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40" />
                {search && <button type="button" onClick={() => setSearch("")} aria-label={t("common.clear")} className="absolute end-2 top-1/2 -translate-y-1/2 text-am-ink-3 hover:text-am-ink"><X className="w-3.5 h-3.5" /></button>}
              </div>
              <ExportMenu onExport={handleExport} rowCount={visible.length} exporting={exporting} error={exportError} />
            </div>
          </div>

          <div className="flex-none space-y-2.5">
            <VcsFilterBar state={filters} actions={actions} stageOptions={stages} sectorOptions={sectors}
              raisingAvailable={raising.size > 0} followingAvailable={followed.size > 0} />
            <FilterChips chips={chips} onClear={actions.clearOne} onClearAll={actions.clearAll} />
            <p className="text-am-caption text-am-ink-3 tabular-nums" aria-live="polite">
              {tt("matching", "{{count}} firms", { count: visible.length.toLocaleString() })}{activeCount > 0 || search ? ` · ${tt("filtered", "filtered")}` : ""}
            </p>
          </div>

          {(error || followError) && (
            <div className="flex-none flex items-start gap-2 rounded-am-card border border-red-100 bg-red-50 px-4 py-2.5 text-am-body text-am-neg" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /><span className="break-words">{error ?? followError}</span>
            </div>
          )}

          <div className={workspace ? "flex-1 min-h-0" : ""}>
            {loading ? (
              <div className="py-24 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-am-ink-3" aria-label={tt("loading", "Loading")} /></div>
            ) : empty ? (
              <div className="py-16 flex flex-col items-center gap-3 text-center px-6 bg-am-surface border border-am-line rounded-am-card">
                <Building2 className="w-8 h-8 text-am-ink-3" aria-hidden="true" />
                {activeCount > 0 || search ? (
                  <>
                    <p className="text-am-title font-medium text-am-ink-2">{tt("noMatch", "No firms match these filters.")}</p>
                    <button type="button" onClick={actions.clearAll} className="text-am-body font-medium text-am-accent hover:underline">{tt("clearAll", "Clear all")}</button>
                  </>
                ) : <p className="text-am-title font-medium text-am-ink-2">{tt("noFirms", "No firms in the directory yet.")}</p>}
              </div>
            ) : (
              <div className={workspace ? "h-full" : "max-h-[70vh]"}>
                <VcsTable firms={page} total={visible.length} sort={sort} onSort={(k: VcSortKey) => setSort((cur) => nextVcSort(cur, k))}
                  activeId={selectedId} onSelect={(f) => setSelectedId(f.id)} isFollowing={isFollowing} onToggleFollow={(f) => void toggleFollow(f)}
                  filings={filings} narrow={panelOpen} loading={false} hasMore={shown < visible.length} onLoadMore={() => setShown((n) => n + PAGE)} />
              </div>
            )}
          </div>
          <p className="flex-none text-am-caption text-am-ink-3 leading-relaxed">
            {tt("footnote", "Firm details come from AlphaMap's directory and may be incomplete: a blank means no value on record. Fund filings are SEC Form D filings of venture funds linked to a firm in the directory.")}
          </p>
        </div>

        {panelOpen && panel && (
          <aside aria-label={tt("firmPanel", "Firm")} className="flex-none w-[min(560px,46vw)] h-full py-4 pe-4 lg:pe-8">{panel}</aside>
        )}
      </div>

      {/* Phones: the same card, full screen */}
      {!workspace && selected && (
        <div className="fixed inset-0 z-50 bg-am-canvas p-3 overflow-hidden" role="dialog" aria-modal="true" aria-label={selected.name}>{panel}</div>
      )}
    </Layout>
  );
}
