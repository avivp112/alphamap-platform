import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Zap, Activity, Gauge,
  ArrowRight, ArrowLeftRight, Building2, Landmark, Sparkles, Info,
  CircleDollarSign, ExternalLink, Loader2, AlertCircle, Check,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { CompanyLogo } from "../components/CompanyLogo";
import type { StartupListRow } from "../../lib/supabase";
import {
  PUBLIC_SECTORS, PUBLIC_SNAPSHOT_AS_OF, ILLIQUIDITY_DISCOUNT,
  deriveAll, computeSectorMultiples, computeSentiment, impliedFairValue,
  fetchPrivateCohort, fetchStartupByName, fetchLiveMarketCaps, hasLiveDataKey,
  fetchPrivateLateStageActivity, sectorConfig, estimateArr,
  type DerivedPublicCompany, type SectorMultiples, type PublicSectorKey,
  type ImpliedValuation, type SentimentIndex, type PrivateLateStageActivity,
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
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Median EV / Revenue</div>
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
        {applied ? <><Check className="w-3.5 h-3.5" />Applied to private</> : <><Zap className="w-3.5 h-3.5" />Apply to private startups</>}
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
  const [applied, setApplied] = useState<PublicSectorKey | null>(null);
  const appliedM = multiples.find((m) => m.key === applied) ?? null;

  return (
    <section>
      <SectionHeading
        icon={CircleDollarSign}
        title="Sector Multiples Matrix"
        subtitle="Public median valuation multiples per core software sector — the benchmark you price private companies against."
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
        title="IPO & Market Sentiment Barometer"
        subtitle="A public-tech momentum read on whether the IPO / late-stage funding window is open — and how private late-stage activity is co-moving."
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
                <div className="flex items-center gap-1.5 mb-1"><TrendingUp className="w-3.5 h-3.5 text-emerald-600" /><span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700/70">Leading sector</span></div>
                <div className="text-sm font-bold text-[#0F172A]">{sentiment.bestSector.label}</div>
                <div className="text-xs font-semibold text-emerald-600 tabular-nums">{fmtPct(sentiment.bestSector.momentum, true)}</div>
              </div>
              <div className="rounded-[12px] bg-rose-50/50 border border-rose-100 px-3.5 py-3">
                <div className="flex items-center gap-1.5 mb-1"><TrendingDown className="w-3.5 h-3.5 text-rose-500" /><span className="text-[9px] font-bold uppercase tracking-wider text-rose-700/70">Lagging sector</span></div>
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
  const cfg = sectorConfig(company.sector);
  // Private implied ARR multiple (last valuation / estimated ARR), when possible.
  const arr = priv ? estimateArr(priv, cfg) : null;
  const privMult = priv && arr && priv.latest_valuation ? priv.latest_valuation / arr : null;
  const spread = privMult != null ? company.evRevenue - privMult : null;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5 px-4 sm:px-5 py-4 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
      {/* Public side */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[#0F172A] text-white text-[10px] font-black">{company.ticker.slice(0, 4)}</div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-[#0F172A] truncate">{company.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-bold tabular-nums" style={{ color: cfg.accent }}>{fmtMult(company.evRevenue)} EV/Rev</span>
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
    <section>
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
  const [liveCaps, setLiveCaps]     = useState<Map<string, number> | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [lastLive, setLastLive]     = useState<Date | null>(null);
  const [activity, setActivity]     = useState<PrivateLateStageActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const companies = useMemo(() => deriveAll(liveCaps), [liveCaps]);
  const multiples = useMemo(() => computeSectorMultiples(companies), [companies]);
  const sentiment = useMemo(() => computeSentiment(companies), [companies]);

  useEffect(() => {
    let cancelled = false;
    setActivityLoading(true);
    fetchPrivateLateStageActivity(Date.now())
      .then((a) => { if (!cancelled) setActivity(a); })
      .catch(() => { if (!cancelled) setActivity(null); })
      .finally(() => { if (!cancelled) setActivityLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function refreshLive() {
    setLiveLoading(true);
    const caps = await fetchLiveMarketCaps();
    if (caps) { setLiveCaps(caps); setLastLive(new Date()); }
    setLiveLoading(false);
  }

  const isLive = liveCaps != null;

  return (
    <Layout>
      {/* Title band — same blue-gray as the other hub pages */}
      <div style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">Public Market Hub</h1>
              <p className="mt-1.5 text-sm text-[#0F172A]/60 leading-snug max-w-2xl">
                Public benchmarks wired to private valuations — sector multiples, an IPO-window barometer, and public-vs-private comps.
              </p>
            </div>
            <div className="flex items-center gap-2.5 flex-none">
              <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                isLive ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white/60 border-black/10 text-[#0F172A]/60"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isLive ? "bg-emerald-500 animate-pulse" : "bg-[#0F172A]/30"}`} />
                {isLive ? `Live · ${lastLive?.toLocaleTimeString()}` : `Snapshot · ${PUBLIC_SNAPSHOT_AS_OF}`}
              </span>
              <button
                onClick={refreshLive}
                disabled={liveLoading || !hasLiveDataKey}
                title={hasLiveDataKey ? "Refresh market caps from Financial Modeling Prep" : "Set VITE_FMP_API_KEY to enable live refresh"}
                className="flex items-center gap-1.5 rounded-[12px] bg-[#0F172A] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1e293b] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${liveLoading ? "animate-spin" : ""}`} />
                {liveLoading ? "Syncing…" : "Refresh live"}
              </button>
              <Link to="/stocks" className="flex items-center gap-1.5 rounded-[12px] bg-white/70 border border-black/10 px-3.5 py-2 text-xs font-bold text-[#0F172A] hover:bg-white transition-all">
                Live quotes <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        <SectorMatrix multiples={multiples} />
        <SentimentBarometer sentiment={sentiment} activity={activity} activityLoading={activityLoading} />
        <CompsExplorer companies={companies} />

        {!hasLiveDataKey && (
          <p className="text-[11px] text-gray-400 leading-relaxed flex items-start gap-1.5 max-w-2xl">
            <Info className="w-3.5 h-3.5 flex-none mt-0.5 text-gray-300" />
            Figures are a labeled reference snapshot ({PUBLIC_SNAPSHOT_AS_OF}). Set a free <span className="font-mono text-gray-500">VITE_FMP_API_KEY</span> (same key the Stocks page uses) to enable one-click live market-cap refresh — enterprise value and every multiple recompute from the fresh caps.
          </p>
        )}
      </div>
    </Layout>
  );
}
