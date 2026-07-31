import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { localeFor } from "../../lib/i18n";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Zap, Activity, Gauge,
  ArrowRight, ArrowLeftRight, Building2, Landmark, Sparkles, Info,
  CircleDollarSign, ExternalLink, Loader2, AlertCircle, Check,
  Search, X, ChevronLeft, ChevronRight, LayoutList, PlusCircle, CheckCircle2,
  MapPin, User, Briefcase, HelpCircle,
} from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis,
} from "recharts";
import { Layout } from "../components/Layout";
import { CompanyLogo } from "../components/CompanyLogo";
import { TickerLogo } from "../components/TickerLogo";
import { ProductTour, type TourStep } from "../components/ProductTour";
import type { StartupListRow } from "../../lib/supabase";

const TOUR_SEEN_KEY = "alphamap_tour_publicmarket_seen";
import {
  PUBLIC_SECTORS, PUBLIC_SNAPSHOT_AS_OF, ILLIQUIDITY_DISCOUNT,
  computeSectorMultiples, computeSentiment, impliedFairValue,
  fetchPrivateCohort, fetchStartupByName, fetchPublicCompanies, triggerSync,
  fetchPrivateLateStageActivity, sectorConfig, estimateArr,
  sectorLabel, sectorAccent, isCuratedSector, searchTickers, syncTickers, hasTicker,
  fetchStockProfile, fetchStockHistory,
  type DerivedPublicCompany, type SectorMultiples, type PublicSectorKey, type AnySectorKey,
  type ImpliedValuation, type SentimentIndex, type PrivateLateStageActivity, type TickerSearchResult,
  type StockProfile, type StockHistoryPoint, type StockHistoryRange,
} from "../../lib/publicMarket";

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmtMoney(usd: number | null | undefined): string {
  if (usd == null || isNaN(usd) || usd === 0) return "—";
  const a = Math.abs(usd);
  if (a >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `$${(usd / 1e9).toFixed(1)}B`;
  if (a >= 1e6)  return `$${(usd / 1e6).toFixed(0)}M`;
  if (a >= 1e3)  return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}
const fmtMoneyM = (m: number) => fmtMoney(m * 1e6);
const fmtMult = (x: number | null | undefined) => (x == null || isNaN(x) ? "—" : `${x.toFixed(1)}×`);
const fmtPct  = (n: number, sign = false) => `${sign && n > 0 ? "+" : ""}${n.toFixed(0)}%`;

// ═════════════════════════════════════════════════════════════════════════════
// 1) SECTOR MULTIPLES MATRIX
// ═════════════════════════════════════════════════════════════════════════════

function SectorCard({ m, applied, onApply }: {
  m: SectorMultiples; applied: boolean; onApply: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="relative flex flex-col rounded-[20px] border bg-white p-5 transition-all duration-200 hover:shadow-[0_12px_32px_rgba(15,23,42,0.08)]"
      style={{ borderColor: applied ? m.accent : "#E5E7EB" }}
    >
      <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-[20px]" style={{ background: m.accent, opacity: 0.85 }} />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-[#0F172A]">{m.label}</h3>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5">
          {m.count} public
        </span>
      </div>

      <div className="mb-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{t("publicMarket.medianEvRevenue")}</div>
        <div className="text-4xl font-black tracking-tight tabular-nums" style={{ color: m.accent }}>
          {fmtMult(m.medianEvRevenue)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="rounded-[10px] bg-gray-50 border border-gray-100 px-2.5 py-2">
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Growth</div>
          <div className="text-sm font-bold text-emerald-600 tabular-nums">{fmtPct(m.avgYoyGrowthPct)}</div>
        </div>
        <div className="rounded-[10px] bg-gray-50 border border-gray-100 px-2.5 py-2">
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">EBITDA mgn</div>
          <div className="text-sm font-bold text-[#0F172A] tabular-nums">{fmtPct(m.avgEbitdaMarginPct)}</div>
        </div>
        <div className="rounded-[10px] bg-gray-50 border border-gray-100 px-2.5 py-2">
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">EV/EBITDA</div>
          <div className="text-sm font-bold text-[#0F172A] tabular-nums">{fmtMult(m.medianEvEbitda)}</div>
        </div>
      </div>

      <button
        onClick={onApply}
        className={`mt-auto flex items-center justify-center gap-1.5 rounded-[12px] px-3 py-2.5 text-xs font-bold transition-all ${
          applied
            ? "text-white"
            : "bg-[#0F172A] text-white hover:bg-[#1e293b]"
        }`}
        style={applied ? { background: m.accent } : undefined}
      >
        {applied ? <><Check className="w-3.5 h-3.5" />{t("publicMarket.appliedToPrivate")}</> : <><Zap className="w-3.5 h-3.5" />{t("publicMarket.applyToStartups")}</>}
      </button>
    </div>
  );
}

function AppliedPrivatePanel({ sectorKey, medianEvRevenue }: {
  sectorKey: PublicSectorKey; medianEvRevenue: number;
}) {
  const cfg = sectorConfig(sectorKey);
  const [rows, setRows]       = useState<ImpliedValuation[] | null>(null);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null);
    fetchPrivateCohort(cfg, 8)
      .then((cohort) => {
        if (cancelled) return;
        setRows(cohort.map((s) => impliedFairValue(s, cfg, medianEvRevenue)));
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load private cohort"); });
    return () => { cancelled = true; };
  }, [sectorKey, medianEvRevenue, cfg]);

  return (
    <div className="rounded-[20px] border border-gray-100 bg-white overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100" style={{ background: `${cfg.accent}0d` }}>
        <Sparkles className="w-4 h-4" style={{ color: cfg.accent }} />
        <h3 className="text-sm font-bold text-[#0F172A]">
          {cfg.label} — private startups valued at public comps
        </h3>
        <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-gray-400">
          <Info className="w-3 h-3" />
          {fmtMult(medianEvRevenue)} median × ARR × {Math.round((1 - ILLIQUIDITY_DISCOUNT) * 100)}% (illiquidity-adj.)
        </span>
      </div>

      {error ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-rose-600"><AlertCircle className="w-4 h-4" />{error}</div>
      ) : rows === null ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 text-gray-300 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-gray-400">No tracked {cfg.label} startups in your database yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-gray-100">
                {["Startup", "Est. ARR", "Implied fair value", "Current valuation", "Gap"].map((h, i) => (
                  <th key={h} className={`py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider text-gray-400 whitespace-nowrap ${i === 0 ? "text-left pl-5" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ startup, estimatedArr, impliedFairValue: ifv, currentValuation, gapPct }) => (
                <tr key={startup.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors">
                  <td className="py-3 px-4 pl-5">
                    <div className="flex items-center gap-2.5">
                      <CompanyLogo name={startup.name} website={startup.website} size={26} rounded="rounded-[7px]" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#0F172A] truncate">{startup.name}</div>
                        <div className="text-[10px] text-gray-400">{startup.employee_count ? `${startup.employee_count} emp` : "headcount n/a"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-xs font-semibold text-gray-500">
                    {estimatedArr != null ? <span className="text-gray-400">~</span> : null}{fmtMoney(estimatedArr)}
                  </td>
                  <td className="py-3 px-4 text-right text-sm font-bold" style={{ color: cfg.accent }}>{fmtMoney(ifv)}</td>
                  <td className="py-3 px-4 text-right text-xs font-semibold text-[#0F172A]">{fmtMoney(currentValuation)}</td>
                  <td className="py-3 px-4 text-right">
                    {gapPct == null ? (
                      <span className="text-xs text-gray-300">—</span>
                    ) : (
                      <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${gapPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {gapPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {fmtPct(gapPct, true)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-5 py-2.5 bg-[#F8FAFC] border-t border-gray-100 text-[10px] text-gray-400 leading-relaxed">
        ARR is <span className="font-semibold">estimated</span> from headcount × sector revenue-per-employee (~{fmtMoney(cfg.revenuePerEmployee)}/head) where revenue isn't on file. A positive gap flags a startup potentially valued below public-comp fair value.
      </div>
    </div>
  );
}

function SectorMatrix({ multiples }: { multiples: SectorMultiples[] }) {
  const { t } = useTranslation();
  const [applied, setApplied] = useState<PublicSectorKey | null>(null);
  const appliedM = multiples.find((m) => m.key === applied) ?? null;

  return (
    <section data-tour="sector-matrix">
      <SectionHeading
        icon={CircleDollarSign}
        title={t("publicMarket.sectorMatrixTitle")}
        subtitle={t("publicMarket.sectorMatrixSubtitle")}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {multiples.map((m) => (
          <SectorCard key={m.key} m={m} applied={applied === m.key} onApply={() => setApplied(applied === m.key ? null : m.key)} />
        ))}
      </div>
      {appliedM && (
        <div className="mt-4">
          <AppliedPrivatePanel sectorKey={appliedM.key} medianEvRevenue={appliedM.medianEvRevenue} />
        </div>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 2) IPO & MARKET SENTIMENT BAROMETER
// ═════════════════════════════════════════════════════════════════════════════

const BAND_COLOR: Record<string, string> = {
  "Closed": "#ef4444", "Tightening": "#f59e0b", "Selective": "#eab308",
  "Open": "#84cc16", "Wide Open": "#22c55e",
};

function Gauge180({ score, band }: { score: number; band: string }) {
  const cx = 110, cy = 110, r = 92;
  const color = BAND_COLOR[band] ?? "#0F172A";
  // Needle angle: score 0 → 180° (left), 100 → 0° (right), swept over the top.
  const theta = (180 - score * 1.8) * (Math.PI / 180);
  const nx = cx + (r - 26) * Math.cos(theta);
  const ny = cy - (r - 26) * Math.sin(theta);
  // sweep-flag 1 draws the arc over the TOP (within the viewBox); the score
  // fills from the left (score 0) rightward via a pathLength-100 dash.
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 220 118" className="w-full max-w-[260px]">
        <path d={arc} fill="none" stroke="#EEF0F2" strokeWidth={15} strokeLinecap="round" />
        <path d={arc} fill="none" stroke={color} strokeWidth={15} strokeLinecap="round"
          pathLength={100} strokeDasharray={`${score} 100`} />
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#0F172A" strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6.5} fill="#0F172A" />
        <circle cx={cx} cy={cy} r={2.5} fill="#fff" />
      </svg>
      <div className="-mt-1 flex items-baseline gap-1">
        <span className="text-4xl font-black tracking-tight text-[#0F172A] tabular-nums">{score}</span>
        <span className="text-xs font-bold text-gray-300">/ 100</span>
      </div>
    </div>
  );
}

function TrendPill({ trend }: { trend: PrivateLateStageActivity["trend"] }) {
  const map = {
    Rising:  { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: TrendingUp },
    Steady:  { cls: "bg-gray-50 text-gray-600 border-gray-200",           Icon: Minus },
    Cooling: { cls: "bg-rose-50 text-rose-700 border-rose-200",           Icon: TrendingDown },
  }[trend];
  const { Icon } = map;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${map.cls}`}>
      <Icon className="w-3 h-3" />{trend}
    </span>
  );
}

function SentimentBarometer({ sentiment, activity, activityLoading }: {
  sentiment: SentimentIndex; activity: PrivateLateStageActivity | null; activityLoading: boolean;
}) {
  const { t } = useTranslation();
  const color = BAND_COLOR[sentiment.band] ?? "#0F172A";
  const coMovement = (() => {
    if (!activity) return null;
    const open = sentiment.score >= 60;
    if (open && activity.trend === "Rising") return "Public window open and private late-stage capital rising — risk appetite is expanding on both sides.";
    if (!open && activity.trend === "Cooling") return "Public window tightening and private late-stage cooling — capital is stepping back across markets.";
    if (open && activity.trend === "Cooling") return "Public window open but private late-stage cooling — private markets lagging the public rally.";
    if (!open && activity.trend === "Rising") return "Private late-stage rising while public window stays selective — dry powder deploying ahead of an IPO thaw.";
    return "Public and private late-stage activity broadly in step.";
  })();

  return (
    <section>
      <SectionHeading
        icon={Gauge}
        title={t("publicMarket.barometerTitle")}
        subtitle={t("publicMarket.barometerSubtitle")}
      />
      <div className="rounded-[20px] border border-gray-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Gauge side */}
          <div className="flex flex-col items-center justify-center p-6 sm:p-8 border-b lg:border-b-0 lg:border-r border-gray-100">
            <Gauge180 score={sentiment.score} band={sentiment.band} />
            <div className="mt-1 flex flex-col items-center">
              <span className="text-lg font-black tracking-tight" style={{ color }}>{sentiment.band}</span>
              <span className="text-[11px] font-semibold text-gray-400">IPO / late-stage window</span>
            </div>
            <div className="mt-4 flex items-center gap-4 text-center">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Avg momentum</div>
                <div className={`text-sm font-bold tabular-nums ${sentiment.avgMomentumPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmtPct(sentiment.avgMomentumPct, true)}</div>
              </div>
              <div className="w-px h-8 bg-gray-100" />
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Avg growth</div>
                <div className="text-sm font-bold text-[#0F172A] tabular-nums">{fmtPct(sentiment.avgGrowthPct)}</div>
              </div>
            </div>
          </div>

          {/* Drivers side */}
          <div className="p-6 sm:p-8 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[12px] bg-emerald-50/60 border border-emerald-100 px-3.5 py-3">
                <div className="flex items-center gap-1.5 mb-1"><TrendingUp className="w-3.5 h-3.5 text-emerald-600" /><span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700/70">{t("publicMarket.leadingSector")}</span></div>
                <div className="text-sm font-bold text-[#0F172A]">{sentiment.bestSector.label}</div>
                <div className="text-xs font-semibold text-emerald-600 tabular-nums">{fmtPct(sentiment.bestSector.momentum, true)}</div>
              </div>
              <div className="rounded-[12px] bg-rose-50/50 border border-rose-100 px-3.5 py-3">
                <div className="flex items-center gap-1.5 mb-1"><TrendingDown className="w-3.5 h-3.5 text-rose-500" /><span className="text-[9px] font-bold uppercase tracking-wider text-rose-700/70">{t("publicMarket.laggingSector")}</span></div>
                <div className="text-sm font-bold text-[#0F172A]">{sentiment.worstSector.label}</div>
                <div className="text-xs font-semibold text-rose-600 tabular-nums">{fmtPct(sentiment.worstSector.momentum, true)}</div>
              </div>
            </div>

            <div className="rounded-[12px] border border-gray-100 bg-gray-50/60 px-4 py-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400"><Activity className="w-3.5 h-3.5" />Private late-stage activity</span>
                {activityLoading ? <Loader2 className="w-3.5 h-3.5 text-gray-300 animate-spin" /> : activity && <TrendPill trend={activity.trend} />}
              </div>
              {activity && (
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-lg font-black text-[#0F172A] tabular-nums leading-none">{activity.recentCount}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">rounds · 90d</div>
                  </div>
                  <div className="w-px h-8 bg-gray-200" />
                  <div>
                    <div className="text-lg font-black text-[#0F172A] tabular-nums leading-none">{fmtMoney(activity.recentVolume)}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">raised · 90d</div>
                  </div>
                  <div className="w-px h-8 bg-gray-200" />
                  <div>
                    <div className="text-lg font-black text-gray-400 tabular-nums leading-none">{activity.priorCount}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">prior 90d</div>
                  </div>
                </div>
              )}
            </div>

            {coMovement && (
              <p className="text-xs text-gray-500 leading-relaxed flex items-start gap-1.5">
                <ArrowLeftRight className="w-3.5 h-3.5 text-gray-300 flex-none mt-0.5" />{coMovement}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 3) PUBLIC vs PRIVATE COMPS EXPLORER
// ═════════════════════════════════════════════════════════════════════════════

function CompRow({ company, priv }: { company: DerivedPublicCompany; priv: StartupListRow | null | undefined }) {
  const accent = sectorAccent(company.sector);
  // Private implied ARR multiple (last valuation / estimated ARR) — only
  // computable for the 4 curated sectors, which carry a revenue-per-employee
  // estimate; ad-hoc "other" tickers have no such benchmark.
  const arr = priv && isCuratedSector(company.sector) ? estimateArr(priv, sectorConfig(company.sector)) : null;
  const privMult = priv && arr && priv.latest_valuation ? priv.latest_valuation / arr : null;
  const spread = privMult != null ? company.evRevenue - privMult : null;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5 px-4 sm:px-5 py-4 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
      {/* Public side */}
      <div className="flex items-center gap-3 min-w-0">
        <TickerLogo ticker={company.ticker} className="h-9 w-9 rounded-[10px] text-[10px]" />
        <div className="min-w-0">
          <div className="text-xs font-bold text-[#0F172A] truncate">{company.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-bold tabular-nums" style={{ color: accent }}>{fmtMult(company.evRevenue)} EV/Rev</span>
            <span className="text-[10px] text-gray-400 tabular-nums">·  {fmtPct(company.yoyGrowthPct)} gr</span>
          </div>
        </div>
      </div>

      {/* Spread */}
      <div className="flex flex-col items-center flex-none w-[76px]">
        {spread == null ? (
          <span className="text-gray-300"><ArrowRight className="w-4 h-4" /></span>
        ) : (
          <>
            <span className="text-[8.5px] font-bold uppercase tracking-wider text-gray-300">spread</span>
            <span className={`text-xs font-black tabular-nums ${spread >= 0 ? "text-amber-600" : "text-sky-600"}`}>{spread >= 0 ? "+" : ""}{spread.toFixed(1)}×</span>
          </>
        )}
      </div>

      {/* Private side */}
      <div className="flex items-center gap-3 min-w-0 justify-end text-right">
        {priv ? (
          <>
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#0F172A] truncate">{priv.name}</div>
              <div className="flex items-center gap-2 mt-0.5 justify-end">
                <span className="text-[10px] text-gray-400 tabular-nums">{fmtMoney(priv.latest_valuation)} val</span>
                {privMult != null && <span className="text-[10px] font-bold tabular-nums text-violet-600">~{privMult.toFixed(1)}× ARR</span>}
              </div>
            </div>
            <CompanyLogo name={priv.name} website={priv.website} size={36} rounded="rounded-[10px]" />
          </>
        ) : priv === null ? (
          <span className="text-[11px] text-gray-300 italic pr-1">not tracked yet</span>
        ) : (
          <Loader2 className="w-4 h-4 text-gray-200 animate-spin" />
        )}
      </div>
    </div>
  );
}

function CompsExplorer({ companies }: { companies: DerivedPublicCompany[] }) {
  const [tab, setTab] = useState<PublicSectorKey | "all">("all");
  const [privMap, setPrivMap] = useState<Map<string, StartupListRow | null>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const withHints = companies.filter((c) => c.privateCompHint);
    Promise.all(
      withHints.map((c) =>
        fetchStartupByName(c.privateCompHint!)
          .then((s) => [c.ticker, s] as const)
          .catch(() => [c.ticker, null] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setPrivMap(new Map(pairs));
    });
    return () => { cancelled = true; };
  }, [companies]);

  const shown = tab === "all" ? companies : companies.filter((c) => c.sector === tab);

  return (
    <section data-tour="comps-explorer">
      <SectionHeading
        icon={ArrowLeftRight}
        title="Public vs Private Comps Explorer"
        subtitle="Public giants mapped to their private counterparts tracked in AlphaMap — the valuation gap and multiple spread at a glance."
      />
      <div className="rounded-[20px] border border-gray-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 sm:px-5 py-3 border-b border-gray-100 overflow-x-auto">
          {([["all", "All"], ...PUBLIC_SECTORS.map((s) => [s.key, s.label] as const)] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key as PublicSectorKey | "all")}
              className={`px-3 py-1.5 rounded-[9px] text-[11px] font-bold whitespace-nowrap transition-all ${
                tab === key ? "bg-[#0F172A] text-white shadow-sm" : "text-gray-500 hover:text-[#0F172A] hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 sm:gap-5 px-4 sm:px-5 py-2 bg-[#F8FAFC] border-b border-gray-100">
          <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400"><Building2 className="w-3 h-3" />Public</span>
          <span className="w-[76px]" />
          <span className="flex items-center gap-1.5 justify-end text-[9px] font-bold uppercase tracking-wider text-gray-400">Private (AlphaMap)<Landmark className="w-3 h-3" /></span>
        </div>
        <div>
          {shown.map((c) => (
            <CompRow key={c.ticker} company={c} priv={c.privateCompHint ? privMap.get(c.ticker) : null} />
          ))}
        </div>
        <div className="px-5 py-2.5 bg-[#F8FAFC] border-t border-gray-100 text-[10px] text-gray-400 leading-relaxed">
          Private ARR multiple is <span className="font-semibold">estimated</span> (last round valuation ÷ headcount-derived ARR). "Not tracked yet" means the private counterpart isn't in your AlphaMap database — add it from the Private Market page.
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 4) STOCK SEARCH + PAGINATED COMPANIES DIRECTORY
// ═════════════════════════════════════════════════════════════════════════════

function StockSearchBar({ companies, onCompanyAdded, onFocusTicker }: {
  companies: DerivedPublicCompany[];
  onCompanyAdded: () => Promise<void>;
  onFocusTicker: (ticker: string) => void;
}) {
  const [query, setQuery]           = useState("");
  const [results, setResults]       = useState<TickerSearchResult[]>([]);
  const [searching, setSearching]   = useState(false);
  const [open, setOpen]             = useState(false);
  const [syncingTicker, setSyncingTicker] = useState<string | null>(null);
  const [syncError, setSyncError]   = useState<string | null>(null);
  const [searchFailure, setSearchFailure] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search-as-you-type against the search-tickers Edge Function.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); setSearchFailure(null); return; }
    setSearching(true);
    const t = setTimeout(() => {
      searchTickers(q).then(({ results, error }) => {
        setResults(results);
        setSearchFailure(error ?? null);
        setSearching(false);
        setOpen(true);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handlePick(r: TickerSearchResult) {
    setSyncError(null);
    if (hasTicker(companies, r.symbol)) {
      onFocusTicker(r.symbol);
      setOpen(false); setQuery("");
      return;
    }
    setSyncingTicker(r.symbol);
    try {
      const res = await syncTickers([r.symbol]);
      if (!res.ok) { setSyncError(res.error ?? "Sync failed — is the Edge Function deployed?"); return; }
      await onCompanyAdded();
      onFocusTicker(r.symbol);
      setOpen(false); setQuery("");
    } finally {
      setSyncingTicker(null);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
        <input
          type="text" value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && setOpen(true)}
          placeholder="Search any NASDAQ or NYSE company — e.g. Airbnb, ABNB…"
          className="w-full pl-10 pr-9 py-3 text-sm bg-white border border-gray-200 rounded-[14px] focus:outline-none focus:border-[#0F172A]/30 focus:ring-2 focus:ring-[#0F172A]/10 transition-all"
        />
        {searching ? (
          <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 animate-spin" />
        ) : query && (
          <button onClick={() => { setQuery(""); setResults([]); }} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-20 mt-2 w-full bg-white rounded-[16px] border border-gray-100 shadow-[0_16px_40px_rgba(15,23,42,0.12)] overflow-hidden max-h-[340px] overflow-y-auto">
          {results.map((r) => {
            const tracked = hasTicker(companies, r.symbol);
            const isSyncing = syncingTicker === r.symbol;
            return (
              <button
                key={r.symbol}
                onClick={() => handlePick(r)}
                disabled={isSyncing}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0 disabled:opacity-60"
              >
                <TickerLogo ticker={r.symbol} className="h-8 w-8 rounded-[9px] text-[9px]" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[#0F172A] truncate">{r.symbol} <span className="font-medium text-gray-400">· {r.name}</span></div>
                  <div className="text-[10px] text-gray-400">{r.exchange}</div>
                </div>
                {isSyncing ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-gray-400 flex-none"><Loader2 className="w-3.5 h-3.5 animate-spin" />Syncing…</span>
                ) : tracked ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 flex-none"><CheckCircle2 className="w-3.5 h-3.5" />Tracked</span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-[#0F172A]/60 flex-none"><PlusCircle className="w-3.5 h-3.5" />Add &amp; sync</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {open && !searching && query.trim() && results.length === 0 && searchFailure && (
        <div className="absolute z-20 mt-2 w-full bg-white rounded-[16px] border border-rose-100 shadow-[0_16px_40px_rgba(15,23,42,0.12)] px-4 py-4">
          <p className="flex items-start gap-1.5 text-xs font-semibold text-rose-600"><AlertCircle className="w-3.5 h-3.5 flex-none mt-0.5" />{searchFailure}</p>
        </div>
      )}
      {open && !searching && query.trim() && results.length === 0 && !searchFailure && (
        <div className="absolute z-20 mt-2 w-full bg-white rounded-[16px] border border-gray-100 shadow-[0_16px_40px_rgba(15,23,42,0.12)] px-4 py-6 text-center text-xs text-gray-400">
          No NASDAQ/NYSE tickers found for "{query}"
        </div>
      )}
      {syncError && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-rose-600"><AlertCircle className="w-3.5 h-3.5 flex-none" />{syncError}</p>
      )}
    </div>
  );
}

const DIRECTORY_PAGE_SIZE = 15;

function getDirectoryPageRange(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const range: Array<number | "…"> = [1];
  if (current > 4) range.push("…");
  for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) range.push(i);
  if (current < total - 3) range.push("…");
  range.push(total);
  return range;
}

function DirectoryPagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  const pages = getDirectoryPageRange(page, pageCount);
  return (
    <div className="flex items-center justify-center gap-1 px-5 py-3.5 border-t border-gray-100 bg-[#F8FAFC]">
      <button onClick={() => onChange(page - 1)} disabled={page === 1}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold text-gray-500 hover:text-[#0F172A] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
        <ChevronLeft className="w-3.5 h-3.5" />Prev
      </button>
      <div className="flex items-center gap-1">
        {pages.map((p, i) => p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-[11px] text-gray-400 select-none">…</span>
        ) : (
          <button key={p} onClick={() => onChange(p as number)}
            className={`min-w-[28px] h-7 px-1.5 rounded-[7px] text-[11px] font-semibold transition-all ${p === page ? "bg-[#0F172A] text-white" : "text-gray-500 hover:bg-white hover:text-[#0F172A]"}`}>
            {p}
          </button>
        ))}
      </div>
      <button onClick={() => onChange(page + 1)} disabled={page === pageCount}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold text-gray-500 hover:text-[#0F172A] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
        Next<ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function CompaniesDirectory({ companies, onCompanyAdded }: {
  companies: DerivedPublicCompany[];
  onCompanyAdded: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [filter, setFilter]             = useState("");
  const [sectorFilter, setSectorFilter] = useState<AnySectorKey | "all">("all");
  const [page, setPage]                 = useState(1);
  const [highlightTicker, setHighlightTicker] = useState<string | null>(null);
  const [pendingHighlight, setPendingHighlight] = useState<string | null>(null);
  const [profileTicker, setProfileTicker] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  const filtered = useMemo(() => {
    let rows = companies;
    if (sectorFilter !== "all") rows = rows.filter((c) => c.sector === sectorFilter);
    const q = filter.trim().toLowerCase();
    if (q) rows = rows.filter((c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q));
    return rows;
  }, [companies, filter, sectorFilter]);

  useEffect(() => { setPage(1); }, [filter, sectorFilter]);

  // A ticker just got synced (or was already tracked) — once it's actually
  // present in the `companies` prop, clear any filter hiding it, jump to its
  // page, and flash-highlight the row. Runs as an effect (not synchronously
  // on click) because `companies` only updates after the parent's reload
  // resolves and re-renders — a plain function call would still see the
  // pre-sync array.
  useEffect(() => {
    if (!pendingHighlight) return;
    const idx = companies.findIndex((c) => c.ticker === pendingHighlight);
    if (idx === -1) return; // not in the (possibly stale) companies prop yet
    setFilter("");
    setSectorFilter("all");
    setPage(Math.floor(idx / DIRECTORY_PAGE_SIZE) + 1);
    setHighlightTicker(pendingHighlight);
    const el = pendingHighlight;
    setPendingHighlight(null);
    requestAnimationFrame(() => {
      setTimeout(() => rowRefs.current.get(el)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    });
  }, [companies, pendingHighlight]);

  useEffect(() => {
    if (!highlightTicker) return;
    const t = setTimeout(() => setHighlightTicker(null), 2500);
    return () => clearTimeout(t);
  }, [highlightTicker]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / DIRECTORY_PAGE_SIZE));
  const safePage  = Math.min(page, pageCount);
  const shown     = filtered.slice((safePage - 1) * DIRECTORY_PAGE_SIZE, safePage * DIRECTORY_PAGE_SIZE);

  const sectorOptions: Array<{ key: AnySectorKey | "all"; label: string }> = [
    { key: "all", label: "All" },
    ...PUBLIC_SECTORS.map((s) => ({ key: s.key, label: s.label })),
    { key: "other", label: "Other" },
  ];

  return (
    <section>
      <SectionHeading
        icon={LayoutList}
        title={t("publicMarket.directoryTitle")}
        subtitle="Every company synced into AlphaMap — the 4 curated sectors plus anything you've searched and added. Search any NASDAQ/NYSE ticker to add it."
      />

      <div data-tour="stock-search" className="mb-4 max-w-lg">
        <StockSearchBar companies={companies} onCompanyAdded={onCompanyAdded} onFocusTicker={setPendingHighlight} />
      </div>

      <div className="rounded-[20px] border border-gray-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
        {/* Filter row */}
        <div data-tour="companies-directory-filter" className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-1 overflow-x-auto">
            {sectorOptions.map((s) => (
              <button
                key={s.key}
                onClick={() => setSectorFilter(s.key)}
                className={`px-2.5 py-1.5 rounded-[8px] text-[11px] font-bold whitespace-nowrap transition-all ${
                  sectorFilter === s.key ? "bg-[#0F172A] text-white shadow-sm" : "text-gray-500 hover:text-[#0F172A] hover:bg-gray-50"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
            <input
              type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter loaded companies…"
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-100 rounded-[9px] focus:outline-none focus:border-gray-300 focus:ring-2 focus:ring-[#0F172A]/10 transition-all"
            />
          </div>
          <span className="text-[10px] font-semibold text-gray-400 whitespace-nowrap">{filtered.length} {filtered.length === 1 ? "company" : "companies"}</span>
        </div>

        {shown.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-gray-400">No companies match — try the search bar above to add one.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-gray-100">
                  {["Company", "Sector", "Exchange", "Market Cap", "EV/Rev", "EV/EBITDA", "Growth", "Momentum"].map((h, i) => (
                    <th key={h} className={`py-2.5 px-4 text-[9px] font-bold uppercase tracking-wider text-gray-400 whitespace-nowrap ${i === 0 ? "text-left pl-5" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr
                    key={c.ticker}
                    ref={(el) => { if (el) rowRefs.current.set(c.ticker, el); else rowRefs.current.delete(c.ticker); }}
                    onClick={() => setProfileTicker(c.ticker)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProfileTicker(c.ticker); } }}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer border-b border-gray-50 last:border-0 transition-colors duration-700 ${
                      highlightTicker === c.ticker ? "bg-amber-50" : "hover:bg-gray-50/60"
                    }`}
                  >
                    <td className="py-3 px-4 pl-5">
                      <div className="flex items-center gap-2.5">
                        <TickerLogo ticker={c.ticker} className="h-8 w-8 rounded-[9px] text-[9px]" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#0F172A] truncate">{c.name}</div>
                          <div className="text-[10px] text-gray-400">{c.ticker}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color: sectorAccent(c.sector), background: `${sectorAccent(c.sector)}14` }}>
                        {sectorLabel(c.sector)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-[11px] text-gray-400">{c.exchange ?? "—"}</td>
                    <td className="py-3 px-4 text-right text-xs font-bold text-[#0F172A]">{fmtMoneyM(c.marketCap)}</td>
                    <td className="py-3 px-4 text-right text-xs font-bold" style={{ color: sectorAccent(c.sector) }}>{fmtMult(c.evRevenue)}</td>
                    <td className="py-3 px-4 text-right text-xs font-semibold text-gray-500">{fmtMult(c.evEbitda)}</td>
                    <td className="py-3 px-4 text-right text-xs font-semibold text-emerald-600">{fmtPct(c.yoyGrowthPct)}</td>
                    <td className="py-3 px-4 text-right">
                      <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${c.momentumPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {c.momentumPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {fmtPct(c.momentumPct, true)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DirectoryPagination page={safePage} pageCount={pageCount} onChange={setPage} />
      </div>

      <StockProfileModal
        ticker={profileTicker}
        company={profileTicker ? companies.find((c) => c.ticker === profileTicker) ?? null : null}
        onClose={() => setProfileTicker(null)}
      />
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 5) STOCK PROFILE MODAL
// ═════════════════════════════════════════════════════════════════════════════

function fmtPrice(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtVolume(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}

function MetricTile({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="rounded-[12px] bg-gray-50 border border-gray-100 px-3.5 py-3">
      <div className="text-[8.5px] font-bold uppercase tracking-wider text-gray-400 mb-1">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={accent ? { color: accent } : { color: "#0F172A" }}>{value}</div>
      {sub && <div className="text-[9.5px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function RangeTile({ low, high, current }: { low: number | null; high: number | null; current: number | null }) {
  const { t } = useTranslation();
  const hasRange = low != null && high != null && high > low;
  const pct = hasRange && current != null ? Math.max(0, Math.min(100, ((current - low!) / (high! - low!)) * 100)) : null;
  return (
    <div className="col-span-2 rounded-[12px] bg-gray-50 border border-gray-100 px-3.5 py-3">
      <div className="text-[8.5px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t("metrics.yearRange")}</div>
      {hasRange ? (
        <>
          <div className="relative h-1.5 rounded-full bg-gray-200/70">
            {pct != null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[#0F172A] border-2 border-white shadow"
                style={{ left: `${pct}%` }}
              />
            )}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] font-bold text-gray-500 tabular-nums">{fmtPrice(low)}</span>
            <span className="text-[10px] font-bold text-gray-500 tabular-nums">{fmtPrice(high)}</span>
          </div>
        </>
      ) : (
        <div className="text-sm font-bold text-gray-300">—</div>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center gap-4 p-6 border-b border-gray-100">
        <div className="w-16 h-16 rounded-[16px] bg-gray-100 flex-none" />
        <div className="flex-1 space-y-2 min-w-0">
          <div className="h-4 w-40 bg-gray-100 rounded" />
          <div className="h-3 w-24 bg-gray-100 rounded" />
        </div>
        <div className="space-y-2 text-right flex-none">
          <div className="h-5 w-20 bg-gray-100 rounded ml-auto" />
          <div className="h-3 w-14 bg-gray-100 rounded ml-auto" />
        </div>
      </div>
      <div className="p-6 space-y-2.5">
        <div className="h-3 w-full bg-gray-100 rounded" />
        <div className="h-3 w-5/6 bg-gray-100 rounded" />
        <div className="h-3 w-3/4 bg-gray-100 rounded" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 px-6 pb-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-[12px]" />)}
      </div>
    </div>
  );
}

// ── Price Chart (the stock-history Edge Function) ───────────────────────────

// Timeframe labels are translated too: "ALL" reads as TODO / 全部 / 全期間, and
// the year/month suffixes differ per language (1Y -> 1A in Spanish).
const HISTORY_RANGES: StockHistoryRange[] = ["1D", "1M", "3M", "1Y", "5Y", "ALL"];

// Axis ticks follow the active UI language, not the browser default, so a
// Japanese reader gets 1月 rather than "Jan" while the app is in Japanese.
function fmtChartTick(t: number, range: StockHistoryRange, locale: string): string {
  const d = new Date(t);
  if (range === "1D") return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (range === "1M" || range === "3M") return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return d.toLocaleDateString(locale, { month: "short", year: "2-digit" });
}

function StockPriceChart({ ticker }: { ticker: string }) {
  const { t, i18n } = useTranslation();
  const [range, setRange]   = useState<StockHistoryRange>("3M");
  const [series, setSeries] = useState<StockHistoryPoint[] | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStockHistory(ticker, range).then(({ series, error }) => {
      if (cancelled) return;
      setSeries(series);
      setError(error ?? null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ticker, range]);

  const chartLocale = localeFor(i18n.resolvedLanguage ?? "en");
  const data = useMemo(() => (series ?? []).map((p) => ({ t: p.t, price: p.c })), [series]);
  const up = data.length >= 2 ? data[data.length - 1].price >= data[0].price : true;
  const lineColor = up ? "#059669" : "#E11D48";
  const gradientId = `priceFill-${ticker}`;

  return (
    <div className="px-6 pb-6 pt-3 border-b border-gray-100">
      <div className="flex items-center justify-end gap-1 mb-2.5">
        {HISTORY_RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
              range === r ? "bg-[#0F172A] text-white" : "text-gray-400 hover:bg-gray-100 hover:text-[#0F172A]"
            }`}
          >
            {t(`publicMarket.chart.${r}`)}
          </button>
        ))}
      </div>

      <div className="h-[180px]">
        {loading ? (
          <div className="h-full w-full rounded-[12px] bg-gray-50 animate-pulse" />
        ) : error || data.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center px-4 overflow-y-auto">
            <AlertCircle className="w-4 h-4 text-gray-300 flex-none" />
            <p className="text-[11px] text-gray-400 leading-snug">{error ?? t("publicMarket.chart.noData")}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(tick) => fmtChartTick(tick, range, chartLocale)}
                tick={{ fill: "#9CA3AF", fontSize: 9, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis domain={["auto", "auto"]} hide />
              <ReTooltip
                cursor={{ stroke: "#E5E7EB", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const pt = payload[0].payload as { t: number; price: number };
                  return (
                    <div className="bg-white border border-gray-100 rounded-[10px] shadow-lg px-3 py-2 text-xs">
                      <p className="font-bold text-[#0F172A] tabular-nums">{fmtPrice(pt.price)}</p>
                      <p className="text-gray-400 text-[10px] mt-0.5">
                        {new Date(pt.t).toLocaleString(chartLocale, range === "1D"
                          ? { hour: "numeric", minute: "2-digit" }
                          : { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={lineColor}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function StockProfileModal({ ticker, company, onClose }: {
  ticker: string | null;
  company: DerivedPublicCompany | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [profile, setProfile]   = useState<StockProfile | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [visible, setVisible]   = useState(false); // drives the enter/exit transition
  const open = !!ticker;

  useEffect(() => {
    if (!ticker) return;
    setProfile(null); setError(null); setFetching(true);
    setVisible(false);
    const raf = requestAnimationFrame(() => setVisible(true));
    fetchStockProfile(ticker).then(({ profile, error }) => {
      setProfile(profile); setError(error ?? null); setFetching(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [ticker]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [open, onClose]);

  if (!open) return null;

  const changeUp = (profile?.changesPercentage ?? 0) >= 0;
  const location = [profile?.city, profile?.state, profile?.country].filter(Boolean).join(", ");
  const accent = company ? sectorAccent(company.sector) : "#0F172A";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`relative w-full max-w-lg max-h-[88vh] rounded-[22px] bg-white shadow-[0_24px_64px_rgba(15,23,42,0.25)] overflow-hidden flex flex-col transition-all duration-200 ${
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-2"
        }`}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3.5 right-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 border border-gray-100 text-gray-400 hover:text-[#0F172A] hover:bg-gray-50 shadow-sm transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="overflow-y-auto">
          {fetching ? (
            <ProfileSkeleton />
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 px-6 text-center">
              <AlertCircle className="w-6 h-6 text-rose-400" />
              <p className="text-sm font-semibold text-rose-600">{error}</p>
              <p className="text-xs text-gray-400">{ticker}</p>
            </div>
          ) : profile ? (
            <>
              {/* Header */}
              <div className="flex items-start gap-4 p-6 border-b border-gray-100">
                <CompanyLogo name={profile.name} website={profile.website} size={56} rounded="rounded-[16px]" />
                <div className="min-w-0 flex-1 pr-8">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-[#0F172A] truncate">{profile.name}</h3>
                    {company && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ color: accent, background: `${accent}14` }}>
                        {sectorLabel(company.sector)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-400">
                    <span className="font-bold text-gray-500">{profile.ticker}</span>
                    {profile.exchange && <><span>·</span><span>{profile.exchange}</span></>}
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="text-lg font-black text-[#0F172A] tabular-nums">{fmtPrice(profile.price)}</div>
                  {profile.change != null && (
                    <div className={`flex items-center justify-end gap-0.5 text-xs font-bold tabular-nums ${changeUp ? "text-emerald-600" : "text-rose-600"}`}>
                      {changeUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {changeUp ? "+" : ""}{profile.change.toFixed(2)} ({changeUp ? "+" : ""}{(profile.changesPercentage ?? 0).toFixed(2)}%)
                    </div>
                  )}
                </div>
              </div>

              <StockPriceChart ticker={profile.ticker} />

              {/* Company Overview */}
              <div className="p-6 border-b border-gray-100 space-y-3">
                {profile.description && (
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-4">{profile.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
                  {profile.industry && (
                    <span className="flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5 text-gray-300" />{profile.industry}</span>
                  )}
                  {profile.ceo && (
                    <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-gray-300" />{profile.ceo}</span>
                  )}
                  {location && (
                    <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-gray-300" />{location}</span>
                  )}
                  {profile.website && (
                    <a href={profile.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-semibold text-[#0F172A] hover:underline">
                      <ExternalLink className="w-3.5 h-3.5 text-gray-300" />{t("common.website")}
                    </a>
                  )}
                </div>
              </div>

              {/* Key Metrics & Valuation */}
              <div className="p-6">
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">{t("publicMarket.keyMetrics")}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <MetricTile label={t("metrics.marketCap")} value={fmtMoney(profile.marketCap)} />
                  <MetricTile label={t("metrics.peRatio")} value={profile.pe != null ? profile.pe.toFixed(1) : "—"} />
                  <MetricTile label={t("metrics.beta")} value={profile.beta != null ? profile.beta.toFixed(2) : "—"} />
                  <MetricTile label={t("metrics.avgVolume")} value={fmtVolume(profile.avgVolume)} />
                  <MetricTile label={t("metrics.dividendYield")} value={profile.dividendYieldPct != null ? `${profile.dividendYieldPct.toFixed(2)}%` : "—"} sub={profile.dividendYieldPct != null ? t("metrics.trailingApprox") : undefined} />
                  <RangeTile low={profile.yearLow} high={profile.yearHigh} current={profile.price} />
                </div>

                {company && (
                  <>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mt-5 mb-2.5">{t("publicMarket.fromSync")}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricTile label={t("metrics.evRevenue")} value={fmtMult(company.evRevenue)} accent={accent} />
                      <MetricTile label={t("metrics.evEbitda")} value={fmtMult(company.evEbitda)} />
                      <MetricTile label={t("metrics.yoyGrowth")} value={fmtPct(company.yoyGrowthPct)} />
                      <MetricTile
                        label={t("metrics.momentum")}
                        value={<span className={company.momentumPct >= 0 ? "text-emerald-600" : "text-rose-600"}>{fmtPct(company.momentumPct, true)}</span>}
                      />
                    </div>
                    {company.privateCompHint && (
                      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-400">
                        <Landmark className="w-3.5 h-3.5 text-gray-300" />
                        {t("publicMarket.trackedCounterpart")} <span className="font-semibold text-gray-500">{company.privateCompHint}</span>
                      </p>
                    )}
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Shared section heading ──────────────────────────────────────────────────

function SectionHeading({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[#0F172A] text-white"><Icon className="w-4 h-4" /></div>
        <h2 className="text-lg font-bold tracking-tight text-[#0F172A]">{title}</h2>
      </div>
      <p className="mt-1.5 text-sm text-gray-500 leading-snug max-w-2xl">{subtitle}</p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGE
// ═════════════════════════════════════════════════════════════════════════════

export function PublicMarket() {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<DerivedPublicCompany[]>([]);
  const [source, setSource]       = useState<"db" | "snapshot">("snapshot");
  const [syncedAt, setSyncedAt]   = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [syncPageError, setSyncPageError] = useState<string | null>(null);
  const [activity, setActivity]   = useState<PrivateLateStageActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  // First-time visitors get the walkthrough automatically, once; anyone else
  // can replay it from the "?" button in the title bar.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem(TOUR_SEEN_KEY)) setTourOpen(true);
  }, []);
  function closeTour() {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
    setTourOpen(false);
  }
  const tourSteps: TourStep[] = [
    { target: '[data-tour="sector-matrix"]',              icon: CircleDollarSign, title: t("tour.publicMarket.steps.sectorMatrix.title"), description: t("tour.publicMarket.steps.sectorMatrix.body") },
    { target: '[data-tour="comps-explorer"]',             icon: ArrowLeftRight,   title: t("tour.publicMarket.steps.comps.title"),        description: t("tour.publicMarket.steps.comps.body") },
    { target: '[data-tour="stock-search"]',               icon: Search,           title: t("tour.publicMarket.steps.search.title"),       description: t("tour.publicMarket.steps.search.body") },
    { target: '[data-tour="companies-directory-filter"]', icon: LayoutList,       title: t("tour.publicMarket.steps.directory.title"),    description: t("tour.publicMarket.steps.directory.body") },
    { target: '[data-tour="sync-controls"]',              icon: RefreshCw,        title: t("tour.publicMarket.steps.sync.title"),         description: t("tour.publicMarket.steps.sync.body") },
  ];

  const multiples = useMemo(() => computeSectorMultiples(companies), [companies]);
  const sentiment = useMemo<SentimentIndex | null>(
    () => (companies.length ? computeSentiment(companies) : null),
    [companies],
  );

  async function loadCompanies() {
    const res = await fetchPublicCompanies();
    setCompanies(res.companies);
    setSource(res.source);
    setSyncedAt(res.syncedAt);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPublicCompanies()
      .then((res) => { if (!cancelled) { setCompanies(res.companies); setSource(res.source); setSyncedAt(res.syncedAt); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setActivityLoading(true);
    fetchPrivateLateStageActivity(Date.now())
      .then((a) => { if (!cancelled) setActivity(a); })
      .catch(() => { if (!cancelled) setActivity(null); })
      .finally(() => { if (!cancelled) setActivityLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // On-demand: kick the Edge Function to pull fresh FMP data, then re-read the
  // table. Re-reads regardless of the sync outcome (best-effort), but now
  // surfaces the actual failure reason instead of silently doing nothing.
  async function handleSync() {
    setSyncing(true);
    setSyncPageError(null);
    const res = await triggerSync();
    if (!res.ok) setSyncPageError(res.error ?? "Sync failed");
    await loadCompanies();
    setSyncing(false);
  }

  const badgeLive = !!syncedAt;
  const badgeText = syncedAt
    ? `Synced · ${new Date(syncedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : source === "db" ? "Seeded · not yet synced" : `Snapshot · ${PUBLIC_SNAPSHOT_AS_OF}`;

  return (
    <Layout>
      {/* Title band — same blue-gray as the other hub pages */}
      <div style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">{t("publicMarket.hubTitle")}</h1>
              <p className="mt-1.5 text-sm text-[#0F172A]/60 leading-snug max-w-2xl">
                {t("publicMarket.hubSubtitle")}
              </p>
            </div>
            <div data-tour="sync-controls" className="flex items-center gap-2.5 flex-none">
              <button
                onClick={() => setTourOpen(true)}
                title={t("tour.takeTour")}
                aria-label={t("tour.takeTour")}
                className="p-2 rounded-[12px] bg-white/60 border border-black/10 text-[#0F172A]/60 hover:text-[#0F172A] hover:bg-white transition-all"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
              <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                badgeLive ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white/60 border-black/10 text-[#0F172A]/60"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${badgeLive ? "bg-emerald-500 animate-pulse" : "bg-[#0F172A]/30"}`} />
                {badgeText}
              </span>
              <button
                onClick={handleSync}
                disabled={syncing}
                title="Pull fresh market data via the sync-public-markets Edge Function, then reload from the database"
                className="flex items-center gap-1.5 rounded-[12px] bg-[#0F172A] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1e293b] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? t("publicMarket.syncing") : t("publicMarket.syncNow")}
              </button>
              <Link to="/stocks" className="flex items-center gap-1.5 rounded-[12px] bg-white/70 border border-black/10 px-3.5 py-2 text-xs font-bold text-[#0F172A] hover:bg-white transition-all">
                {t("publicMarket.liveQuotes")} <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
          {syncPageError && (
            <div className="mt-3 flex items-start gap-1.5 rounded-[10px] bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-semibold text-rose-700 max-w-2xl">
              <AlertCircle className="w-3.5 h-3.5 flex-none mt-0.5" />{syncPageError}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {loading ? (
          <div className="flex items-center justify-center py-32"><Loader2 className="w-6 h-6 text-gray-300 animate-spin" /></div>
        ) : (
          <>
            <SectorMatrix multiples={multiples} />
            {sentiment && <SentimentBarometer sentiment={sentiment} activity={activity} activityLoading={activityLoading} />}
            <CompsExplorer companies={companies} />
            <CompaniesDirectory companies={companies} onCompanyAdded={loadCompanies} />

            <p className="text-[11px] text-gray-400 leading-relaxed flex items-start gap-1.5 max-w-3xl">
              <Info className="w-3.5 h-3.5 flex-none mt-0.5 text-gray-300" />
              Data is read from the <span className="font-mono text-gray-500">public_companies</span> table, refreshed daily in the background by the <span className="font-mono text-gray-500">sync-public-markets</span> Supabase Edge Function (Financial Modeling Prep). {syncedAt ? "Use " : "Until the first sync runs these are a labeled reference snapshot — use "}<span className="font-semibold">Sync now</span> to pull fresh figures on demand.
            </p>
          </>
        )}
      </div>

      <ProductTour steps={tourSteps} open={tourOpen} onClose={closeTour} />
    </Layout>
  );
}
