import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  DollarSign, TrendingUp, Search, X, ChevronUp, ChevronDown, Activity, Calendar,
  Layers, Building2, HelpCircle, Landmark, ExternalLink, Eye, Loader2, AlertCircle,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { ExportMenu } from "../components/SideFilterLayout";
import { DealDetailModal } from "../components/DealDetailModal";
import { ProductTour, type TourStep } from "../components/ProductTour";
import { fetchDealFeed, fetchDealFeedForExport, fetchDealFeedStats } from "../../lib/supabase";
import { fmtUsd, exportColumns, type DealFeedRow, type DealFeedStats, type DealKind, type DealSort } from "../../lib/dealFeed";
import { exportRows, type ExportFormat } from "../../lib/exportData";

// ─────────────────────────────────────────────────────────────────────────────
// Deal Flow — the deal_feed view (migration 20261020000000): SEC Form D
// rounds of technology companies that pass AlphaMap's quality gate, and
// venture fund raises. Filled every morning by the SEC worker; nothing on
// this page is made up. Until 2026-10-20 it showed hard-coded demo deals
// (its list never re-rendered once real rows arrived) and a deal window that
// invented investors and runway from a hash of the company name.
// ─────────────────────────────────────────────────────────────────────────────

const TOUR_SEEN_KEY = "alphamap_tour_deals_seen";
const PAGE = 50;

const SECTOR_CONFIG: Record<string, { bg: string; text: string; border: string }> = {
  "AI & ML":                { bg: "rgba(34,211,238,0.08)",  text: "#0e7490", border: "rgba(34,211,238,0.20)" },
  "Cybersecurity":          { bg: "rgba(167,139,250,0.08)", text: "#6d28d9", border: "rgba(167,139,250,0.20)" },
  "Fintech":                { bg: "rgba(96,165,250,0.08)",  text: "#1d4ed8", border: "rgba(96,165,250,0.20)" },
  "SaaS & Dev Tools":       { bg: "rgba(52,211,153,0.08)",  text: "#047857", border: "rgba(52,211,153,0.20)" },
  "Health & Life Sciences": { bg: "rgba(251,113,133,0.08)", text: "#be123c", border: "rgba(251,113,133,0.20)" },
  "Climate & Energy":       { bg: "rgba(132,204,22,0.08)",  text: "#4d7c0f", border: "rgba(132,204,22,0.22)" },
  "DeepTech":               { bg: "rgba(249,115,22,0.08)",  text: "#c2410c", border: "rgba(249,115,22,0.20)" },
  "Venture Capital":        { bg: "rgba(245,158,11,0.10)",  text: "#92400e", border: "rgba(245,158,11,0.30)" },
  default:                  { bg: "rgba(100,116,139,0.08)", text: "#475569", border: "rgba(100,116,139,0.20)" },
};

const AVATAR_BG = ["#1e3a5f", "#1e2d54", "#2d1b47", "#1a3d2b", "#3d1a1a", "#1a3d3d", "#3d2d1a", "#2d1a3d"];
const AVATAR_FG = ["#93c5fd", "#a5b4fc", "#d8b4fe", "#6ee7b7", "#fca5a5", "#67e8f9", "#fcd34d", "#c4b5fd"];

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
}

function daysAgo(iso: string): string {
  const diff = Math.floor((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "1d ago";
  return `${diff}d ago`;
}

/** Initials and a stable colour pair from the name — decoration only. */
function avatar(name: string): { bg: string; fg: string; initials: string } {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const i = h % AVATAR_BG.length;
  const initials = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return { bg: AVATAR_BG[i], fg: AVATAR_FG[i], initials };
}

function SectorPill({ sector }: { sector: string }) {
  const cfg = SECTOR_CONFIG[sector] ?? SECTOR_CONFIG.default;
  return (
    <span className="inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
      {sector}
    </span>
  );
}

function HudCard({ accent, icon: Icon, label, value, sub }: {
  accent: string; icon: React.ElementType; label: string; value: string; sub?: string;
}) {
  return (
    <div className="relative rounded-[9px] px-5 py-4 overflow-hidden bg-white"
      style={{ border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)" }}>
      <div className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="w-3.5 h-3.5 flex-none" style={{ color: accent }} />
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.13em]">{label}</span>
      </div>
      <div className="text-2xl font-black text-gray-900 leading-none tracking-tight truncate">{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-1.5 leading-snug truncate">{sub}</div>}
    </div>
  );
}

function ColHeader({ col, label, sort, asc, onSort }: {
  col: DealSort | null; label: string; sort: DealSort; asc: boolean; onSort: (c: DealSort) => void;
}) {
  if (!col) return <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.13em]">{label}</span>;
  const active = sort === col;
  return (
    <button onClick={() => onSort(col)}
      className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.13em] transition-colors ${active ? "text-gray-700" : "text-gray-400 hover:text-gray-600"}`}>
      {label}
      <span className="opacity-60 flex flex-col -space-y-1">
        <ChevronUp className={`w-2.5 h-2.5 ${active && asc ? "opacity-100" : "opacity-30"}`} />
        <ChevronDown className={`w-2.5 h-2.5 ${active && !asc ? "opacity-100" : "opacity-30"}`} />
      </span>
    </button>
  );
}

const GRID = "96px minmax(0,1fr) 150px 104px 104px 28px";

export function Deals() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<DealKind>("company");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<DealSort>("deal_date");
  const [asc, setAsc] = useState(false);
  const [rows, setRows] = useState<DealFeedRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DealFeedStats | null>(null);
  const [selected, setSelected] = useState<DealFeedRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem(TOUR_SEEN_KEY)) setTourOpen(true); } catch { /* storage blocked */ }
  }, []);
  function closeTour() {
    try { localStorage.setItem(TOUR_SEEN_KEY, "1"); } catch { /* storage blocked */ }
    setTourOpen(false);
  }
  const tourSteps: TourStep[] = [
    { target: '[data-tour="deals-search"]', icon: Search, title: t("tour.deals.steps.search.title"), description: t("tour.deals.steps.search.body") },
    { target: '[data-tour="deals-hud"]', icon: Activity, title: t("tour.deals.steps.hud.title"), description: t("tour.deals.steps.hud.body") },
    { target: '[data-tour="deals-sort-headers"]', icon: ChevronDown, title: t("tour.deals.steps.sort.title"), description: t("tour.deals.steps.sort.body") },
    { target: '[data-tour="deals-first-row"]', icon: Building2, title: t("tour.deals.steps.row.title"), description: t("tour.deals.steps.row.body") },
  ];

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDealFeed({ kind, search: debounced, sort, ascending: asc, limit: PAGE, offset });
      setRows((prev) => (offset === 0 ? res.rows : [...prev, ...res.rows]));
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (offset === 0) setRows([]);
    } finally {
      setLoading(false);
    }
  }, [kind, debounced, sort, asc]);

  useEffect(() => { void load(0); }, [load]);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    fetchDealFeedStats(kind).then((s) => { if (!cancelled) setStats(s); }).catch(() => { /* headline numbers are optional */ });
    return () => { cancelled = true; };
  }, [kind]);

  function handleSort(col: DealSort) {
    if (col === sort) setAsc((a) => !a);
    else { setSort(col); setAsc(false); }
  }

  async function handleExport(format: ExportFormat) {
    setExporting(true);
    setExportError(null);
    try {
      const all = await fetchDealFeedForExport({ kind, search: debounced, sort, ascending: asc });
      exportRows(all, exportColumns(kind), kind === "fund" ? "alphamap-vc-fund-raises" : "alphamap-deals", format);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : t("common.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  const isFund = kind === "fund";
  const hasMore = rows.length < total;

  return (
    <Layout>
      {/* ── Title band ── */}
      <div style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-7 pb-6">
          <div className="flex items-center justify-between gap-4 mb-1.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">{t("deals.title")}</h1>
            <button onClick={() => setTourOpen(true)} title={t("tour.takeTour")} aria-label={t("tour.takeTour")}
              className="p-2 rounded-[8px] bg-white/60 border border-black/10 text-[#0F172A]/60 hover:text-[#0F172A] hover:bg-white transition-all">
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-[#0F172A]/60 font-medium">{t("deals.subtitle")}</p>
          {stats?.latest_date && (
            <p className="mt-1 text-[11px] text-[#0F172A]/50">{t("deals.latestFiling", { date: fmtDate(stats.latest_date) })}</p>
          )}
        </div>
      </div>

      <div className="bg-[#F8F9FA] min-h-screen">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5">

          {/* ── Kind tabs ── */}
          <div className="flex items-center gap-1 border-b border-gray-200 -mx-1 overflow-x-auto">
            {(["company", "fund"] as DealKind[]).map((k) => (
              <button key={k} onClick={() => { setKind(k); setSelected(null); }}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  kind === k ? "border-[#0F172A] text-[#0F172A]" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
                {k === "company" ? <Building2 className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
                {t(k === "company" ? "deals.tabCompanies" : "deals.tabFunds")}
              </button>
            ))}
          </div>

          {/* ── Headline numbers (whole feed of this kind) ── */}
          <div data-tour="deals-hud" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <HudCard accent="#22d3ee" icon={DollarSign} label={t("deals.totalSold")}
              value={stats ? fmtUsd(stats.total_raised) : "…"}
              sub={stats ? t(isFund ? "deals.fundsCount" : "deals.dealsCount", { count: stats.count }) : undefined} />
            <HudCard accent="#F59E0B" icon={TrendingUp} label={t("deals.largestDeal")}
              value={stats ? fmtUsd(stats.largest_amount) : "…"} sub={stats?.largest_name ?? undefined} />
            <HudCard accent="#a78bfa" icon={Layers} label={t(isFund ? "deals.mostActiveFirm" : "deals.mostActiveSector")}
              value={stats?.top_key ?? (stats ? "—" : "…")}
              sub={stats?.top_count ? t(isFund ? "deals.fundsCount" : "deals.dealsCount", { count: stats.top_count }) : undefined} />
            <HudCard accent="#34d399" icon={Calendar} label={t("deals.newThisMonth")}
              value={stats ? String(stats.month_count) : "…"}
              sub={stats ? (stats.month_count > 0 ? t("deals.soldThisMonth", { amount: fmtUsd(stats.month_raised) }) : t("deals.noNewDeals")) : undefined} />
          </div>

          {/* ── Table card ── */}
          <div className="relative rounded-[10px] overflow-hidden bg-white"
            style={{ border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.05)" }}>
            <div className="px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <Activity className="w-4 h-4 text-amber-500 flex-none" />
                <span className="text-xs font-bold text-gray-900 uppercase tracking-widest">{t("deals.ledger")}</span>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div data-tour="deals-search" className="relative flex-1 sm:flex-none">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder={t(isFund ? "deals.searchFund" : "deals.searchCompany")}
                    className="w-full sm:w-56 pl-8 pr-8 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 rounded-[10px] bg-gray-50 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/30" />
                  {search && (
                    <button onClick={() => setSearch("")} aria-label={t("common.clear")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
                  )}
                </div>
                <ExportMenu onExport={handleExport} rowCount={total} exporting={exporting} error={exportError}
                  note={total > 5000 ? t("common.exportCapped", { cap: "5,000" }) : undefined} />
              </div>
            </div>

            {error && (
              <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" /><span className="break-words">{error}</span>
              </div>
            )}

            <div className="overflow-x-auto">
              <div style={{ minWidth: "720px" }}>
                <div data-tour="deals-sort-headers" className="grid px-5 py-3 gap-4 bg-gray-50 border-b border-gray-100" style={{ gridTemplateColumns: GRID }}>
                  <ColHeader col="deal_date" label={t("deals.date")} sort={sort} asc={asc} onSort={handleSort} />
                  <ColHeader col={null} label={t(isFund ? "deals.fund" : "deals.company")} sort={sort} asc={asc} onSort={handleSort} />
                  <ColHeader col={null} label={t(isFund ? "deals.firm" : "deals.secIndustry")} sort={sort} asc={asc} onSort={handleSort} />
                  <ColHeader col="amount_raised" label={t("deals.sold")} sort={sort} asc={asc} onSort={handleSort} />
                  <ColHeader col="target_amount" label={t("deals.offering")} sort={sort} asc={asc} onSort={handleSort} />
                  <span />
                </div>

                {rows.map((deal, idx) => {
                  const av = avatar(deal.name);
                  return (
                    <div key={deal.id} data-tour={idx === 0 ? "deals-first-row" : undefined}
                      role="button" tabIndex={0}
                      onClick={() => setSelected(deal)}
                      onKeyDown={(e) => { if (e.key === "Enter") setSelected(deal); }}
                      className="grid px-5 py-3.5 gap-4 cursor-pointer hover:bg-slate-50 transition-colors border-b border-gray-50 last:border-0"
                      style={{ gridTemplateColumns: GRID }}>
                      <div className="flex flex-col justify-center gap-0.5">
                        <span className="text-xs font-bold text-gray-700 tabular-nums">{fmtDate(deal.deal_date)}</span>
                        <span className="text-[9px] text-gray-400">{daysAgo(deal.deal_date)}</span>
                      </div>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black flex-none"
                          style={{ background: av.bg, color: av.fg }}>{av.initials}</div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-gray-900 truncate">{deal.name}</div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            {deal.sector && <SectorPill sector={deal.sector} />}
                            {deal.review_status === "unreviewed" && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700" title={t(isFund ? "deals.newFirmHint" : "deals.unreviewedHint")}>
                                <Eye className="w-2.5 h-2.5" />{t(isFund ? "deals.newFirm" : "deals.unreviewed")}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center min-w-0">
                        <span className="text-xs text-gray-500 truncate">
                          {isFund ? [deal.firm_name, deal.fund_series ? `#${deal.fund_series}` : null].filter(Boolean).join(" · ") || "—" : deal.industry_group ?? "—"}
                        </span>
                      </div>
                      <div className="flex items-center"><span className="text-xs font-black text-gray-900 tabular-nums">{fmtUsd(deal.amount_raised)}</span></div>
                      <div className="flex items-center"><span className="text-xs text-gray-500 tabular-nums">{fmtUsd(deal.target_amount)}</span></div>
                      <div className="flex items-center justify-end">
                        {deal.source_url && (
                          <a href={deal.source_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                            title={t("deals.detail.secFiling")} aria-label={t("deals.detail.secFiling")} className="text-gray-300 hover:text-blue-600">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}

                {!loading && !error && rows.length === 0 && (
                  <div className="py-16 flex flex-col items-center gap-3 text-center px-6">
                    <Building2 className="w-8 h-8 text-gray-300" />
                    {debounced ? (
                      <>
                        <p className="text-sm text-gray-500 font-medium">{t("deals.noDealsMatch")}</p>
                        <button onClick={() => setSearch("")} className="text-xs text-cyan-600 hover:text-cyan-700">{t("common.clearAllFilters")}</button>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-gray-600 font-semibold">{t("deals.emptyTitle")}</p>
                        <p className="text-xs text-gray-400 max-w-md">{t("deals.emptyBody")}</p>
                      </>
                    )}
                  </div>
                )}
                {loading && (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                )}
              </div>
            </div>

            <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100">
              <span className="text-[10px] text-gray-400">
                {t("deals.showingOf", { shown: rows.length, total })}
              </span>
              {hasMore && !loading && (
                <button onClick={() => load(rows.length)} className="rounded-md border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                  {t("deals.loadMore")}
                </button>
              )}
            </div>
          </div>

          <p className="text-[11px] text-gray-500 leading-relaxed px-1">{t(isFund ? "deals.fundsFootnote" : "deals.companiesFootnote")}</p>
        </div>
      </div>

      {selected && <DealDetailModal deal={selected} onClose={() => setSelected(null)} />}
      <ProductTour steps={tourSteps} open={tourOpen} onClose={closeTour} />
    </Layout>
  );
}
