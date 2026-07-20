import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Globe, X, DollarSign, Briefcase, Activity, Building2, Landmark,
  ChevronLeft, ChevronRight, Search, Zap, MapPin, Calendar, Users,
  LayoutGrid, List, Clock, AlertCircle, Loader2, ExternalLink, TrendingUp,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { CompanyLogo } from "../components/CompanyLogo";
import { LinkedInBadge } from "../components/LinkedInBadge";
import {
  fetchPEFirms, fetchPEFirmPortfolio, fetchPEFirmTransactions,
  type PEFirmRow, type PEPortfolioCompany, type PETransaction,
} from "../../lib/supabase";

// ─── Helpers (same formatting conventions as Startups.tsx) ────────────────────

function fmt(usd: number | null | undefined): string {
  if (!usd) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd}`;
}
function fmtEmp(n: number | null): string {
  if (!n) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function parseAumMillions(fundSize: string | null): number | null {
  if (!fundSize) return null;
  const b = fundSize.match(/\$?([\d.]+)B/i);
  if (b) return Math.round(parseFloat(b[1]) * 1_000);
  const m = fundSize.match(/\$?([\d.]+)M/i);
  if (m) return Math.round(parseFloat(m[1]));
  return null;
}
function formatAUM(m: number | null): string {
  if (m == null) return "—";
  return m >= 1_000 ? `$${(m / 1_000).toFixed(1)}B` : `$${m}M`;
}
function avatarColor(name: string): string {
  const colors = [
    "bg-violet-100 text-violet-700", "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700",
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[h % colors.length];
}
function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
}

// Deal-type badges — same palette rows as Startups' ROUND_STYLE for these types
const DEAL_STYLE: Record<string, string> = {
  "PE Buyout": "bg-slate-100 text-slate-700 border border-slate-200",
  "Secondary": "bg-stone-50 text-stone-600 border border-stone-200",
};

// Stability semantics for MATURE companies: holding steady is healthy — only
// contraction reads as a warning. Mirrors the mature-track scoring pillar.
const STABILITY_BADGE: Record<string, { label: string; cls: string }> = {
  "rapid growth":    { label: "Growing fast", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  "moderate growth": { label: "Growing",      cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  "stable":          { label: "Stable",       cls: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  "reduction":       { label: "Contracting",  cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

// Highly visible placeholder for any missing dataset — same product decision
// as the Startups tearsheet: missing data is never mocked.
function MissingDataState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 bg-amber-50/60 border border-amber-200/60 rounded-[12px] px-4 py-3.5">
      <AlertCircle className="w-4 h-4 text-amber-500 flex-none mt-0.5" />
      <p className="text-xs text-amber-800/80 leading-relaxed">{message}</p>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent = "#F59E0B" }: {
  icon: React.ElementType; label: string; value: string; accent?: string;
}) {
  return (
    <div className="rounded-[14px] p-4 flex flex-col gap-2 border bg-gray-50 border-gray-100">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 flex-none" style={{ color: accent }} />
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <span className="text-sm font-bold text-gray-900 truncate">{value}</span>
    </div>
  );
}

// ─── AUM slider steps (PE scale — an order of magnitude above the VC page) ────

const AUM_STEPS = [
  { value: "all",   label: "All"        },
  { value: "sub1b", label: "< $1B"      },
  { value: "mid",   label: "$1B–$10B"   },
  { value: "large", label: "$10B–$50B"  },
  { value: "mega",  label: "$50B+"      },
] as const;
type AumStep = typeof AUM_STEPS[number]["value"];

function StepSlider({
  steps, value, onChange,
}: {
  steps:    ReadonlyArray<{ value: string; label: string }>;
  value:    string;
  onChange: (v: string) => void;
}) {
  const idx = Math.max(0, steps.findIndex(s => s.value === value));
  const pct = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 0;

  return (
    <div>
      <div className="relative h-4 flex items-center mx-1">
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-black/10" />
        <div
          className="absolute left-0 h-[3px] rounded-full bg-[#0F172A] transition-all duration-100"
          style={{ width: `${pct}%` }}
        />
        {steps.map((_, i) => (
          <div
            key={i}
            className={`absolute w-2.5 h-2.5 rounded-full border-[2px] -translate-x-1/2 transition-all duration-100 ${
              i < idx   ? "bg-[#0F172A] border-[#0F172A]" :
              i === idx ? "bg-white border-[#0F172A] scale-125" :
                          "bg-white border-black/20"
            }`}
            style={{ left: `${steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0}%` }}
          />
        ))}
        <input
          type="range" min={0} max={steps.length - 1} step={1} value={idx}
          onChange={e => onChange(steps[Number(e.target.value)].value)}
          className="absolute inset-x-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
      </div>
      <div className="flex justify-between mt-2 px-0.5">
        {steps.map((s, i) => (
          <button
            key={s.value}
            onClick={() => onChange(s.value)}
            className={`text-[9px] font-semibold leading-none transition-colors ${
              i === idx ? "text-[#0F172A]" : "text-[#0F172A]/45 hover:text-[#0F172A]/70"
            }`}
            style={{ minWidth: 0 }}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Pagination (identical to the VC directory's) ─────────────────────────────

const PAGE_SIZE = 30;

function getPageRange(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const range: Array<number | "…"> = [1];
  if (current > 4) range.push("…");
  for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) range.push(i);
  if (current < total - 3) range.push("…");
  range.push(total);
  return range;
}

function Pagination({ page, pageCount, onChange }: {
  page: number; pageCount: number; onChange: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  const pages = getPageRange(page, pageCount);
  return (
    <div className="flex items-center justify-center gap-1 mt-10 mb-2">
      <button
        onClick={() => onChange(page - 1)} disabled={page === 1}
        className="flex items-center gap-1 px-3 py-2 rounded-[10px] text-xs font-semibold text-gray-500 hover:text-[#0F172A] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-transparent hover:border-gray-200"
      >
        <ChevronLeft className="w-3.5 h-3.5" />Prev
      </button>
      <div className="flex items-center gap-1">
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-1.5 text-xs text-gray-400 select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p as number)}
              className={`min-w-[32px] h-8 px-2 rounded-[8px] text-xs font-semibold transition-all ${
                p === page
                  ? "bg-[#0F172A] text-white shadow-sm"
                  : "text-gray-500 hover:bg-white hover:text-[#0F172A] border border-transparent hover:border-gray-200"
              }`}
            >
              {p}
            </button>
          ),
        )}
      </div>
      <button
        onClick={() => onChange(page + 1)} disabled={page === pageCount}
        className="flex items-center gap-1 px-3 py-2 rounded-[10px] text-xs font-semibold text-gray-500 hover:text-[#0F172A] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-transparent hover:border-gray-200"
      >
        Next<ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── PE firm card (grid view) ─────────────────────────────────────────────────

function PEFirmCard({ firm, onClick }: { firm: PEFirmRow; onClick: () => void }) {
  const aum = parseAumMillions(firm.fund_size);
  const tagline = (firm.description ?? "").split(/\.\s/)[0];

  return (
    <div
      className="relative group flex flex-col overflow-hidden rounded-[22px] border transition-all duration-300 cursor-pointer select-none"
      onClick={onClick}
      style={{
        background: "#FFFFFF",
        borderColor: "#E5E7EB",
        boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
        willChange: "transform",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget;
        el.style.transform = "translateY(-4px)";
        el.style.borderColor = "rgba(71,85,105,0.30)";
        el.style.boxShadow = "0 16px 40px rgba(15,23,42,0.10), 0 0 0 1px rgba(71,85,105,0.22)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget;
        el.style.transform = "";
        el.style.borderColor = "#E5E7EB";
        el.style.boxShadow = "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)";
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{ background: "linear-gradient(90deg, transparent, rgba(71,85,105,0.35), transparent)" }}
      />

      {/* Header */}
      <div className="px-5 pt-5 pb-3 relative z-10">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <CompanyLogo name={firm.firm_name} website={firm.website} size={44} rounded="rounded-xl" />
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-gray-900 truncate leading-tight tracking-tight">
                {firm.firm_name}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-1 leading-tight">
                {tagline || (firm.headquarters ?? "Private equity firm")}
              </p>
            </div>
          </div>
          {firm.website && (
            <a
              href={firm.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex-none p-1.5 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={`Visit ${firm.firm_name}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {firm.buyout_count > 0 && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${DEAL_STYLE["PE Buyout"]}`}>
              {firm.buyout_count} Buyout{firm.buyout_count === 1 ? "" : "s"}
            </span>
          )}
          {firm.secondary_count > 0 && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${DEAL_STYLE["Secondary"]}`}>
              {firm.secondary_count} Secondar{firm.secondary_count === 1 ? "y" : "ies"}
            </span>
          )}
          {firm.tier === 1 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-amber-50 text-amber-700 border border-amber-200">
              Top-Tier
            </span>
          )}
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-1.5 px-4 py-3 relative z-10">
        <div className="rounded-[10px] px-2.5 py-2.5 bg-gray-50 border border-gray-100">
          <div className="flex items-center gap-1 mb-1">
            <DollarSign className="w-2.5 h-2.5 text-emerald-600 flex-none" />
            <span className="text-[8.5px] font-bold text-gray-400 uppercase tracking-wider">AUM</span>
          </div>
          <div className="text-sm font-bold text-emerald-600 leading-none">{formatAUM(aum)}</div>
        </div>
        <div className="rounded-[10px] px-2.5 py-2.5 bg-gray-50 border border-gray-100">
          <div className="flex items-center gap-1 mb-1">
            <Briefcase className="w-2.5 h-2.5 text-cyan-600 flex-none" />
            <span className="text-[8.5px] font-bold text-gray-400 uppercase tracking-wider">Portfolio</span>
          </div>
          <div className="text-sm font-bold text-cyan-600 leading-none">{firm.portfolio_count || "—"}</div>
        </div>
        <div className="rounded-[10px] px-2.5 py-2.5 bg-gray-50 border border-gray-100">
          <div className="flex items-center gap-1 mb-1">
            <Activity className="w-2.5 h-2.5 text-amber-600 flex-none" />
            <span className="text-[8.5px] font-bold text-gray-400 uppercase tracking-wider">Deal Value</span>
          </div>
          <div className="text-sm font-bold text-amber-600 leading-none">{fmt(firm.total_deal_value)}</div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 mt-auto flex items-center justify-between gap-2 relative z-10 border-t border-gray-100">
        <div className="flex items-center gap-1.5 min-w-0">
          <Globe className="w-3 h-3 text-gray-400 flex-none" />
          <span className="text-[10px] text-gray-500 truncate">{firm.headquarters ?? "—"}</span>
        </div>
        <span className="text-[10px] text-gray-400 font-medium flex-none">
          {firm.latest_deal_date ? `Latest deal ${fmtDate(firm.latest_deal_date)}` : firm.founded_year ? `Est. ${firm.founded_year}` : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Tearsheet: Overview tab ──────────────────────────────────────────────────

function PEOverviewTab({ firm }: { firm: PEFirmRow }) {
  const aum = parseAumMillions(firm.fund_size);
  const leadership = firm.leadership ?? [];

  return (
    <div className="space-y-6">
      {firm.description ? (
        <p className="text-sm text-gray-700 leading-relaxed">{firm.description}</p>
      ) : (
        <MissingDataState message="No firm description on file." />
      )}

      {firm.thesis && (
        <div className="bg-gray-50 border border-gray-100 rounded-[14px] px-4 py-3.5">
          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Investment Thesis</div>
          <p className="text-sm text-gray-700 leading-relaxed italic">{firm.thesis}</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={DollarSign} label="AUM / Fund Size" value={firm.fund_size ?? formatAUM(aum)} accent="#059669" />
        <StatCard icon={Calendar}   label="Founded"         value={firm.founded_year ? String(firm.founded_year) : "—"} accent="#F59E0B" />
        <StatCard icon={MapPin}     label="Headquarters"    value={firm.headquarters ?? "—"} accent="#0e7490" />
        <StatCard icon={Briefcase}  label="Portfolio"       value={firm.portfolio_count ? String(firm.portfolio_count) : "—"} accent="#6d28d7" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Landmark} label="Buyouts on Record"     value={String(firm.buyout_count)} accent="#475569" />
        <StatCard icon={Activity} label="Total Disclosed Value" value={fmt(firm.total_deal_value)} accent="#be185d" />
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Briefcase className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Leadership</h3>
        </div>
        {leadership.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {leadership.map((l, i) => (
              <div key={i} className="flex items-center gap-2.5 bg-gray-50 border border-gray-100 rounded-[12px] px-3 py-2">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-none ${avatarColor(l.name)}`}>
                  {l.name[0]}
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-900 leading-tight">{l.name}</div>
                  <div className="text-[9px] text-gray-400">{l.role}</div>
                </div>
                <LinkedInBadge url={l.linkedin_url} name={l.name} />
              </div>
            ))}
          </div>
        ) : (
          <MissingDataState message="No leadership team has been recorded for this firm yet." />
        )}
      </div>
    </div>
  );
}

// ─── Tearsheet: Portfolio tab (mature-market metrics, not VC hyper-growth) ────

function PEPortfolioTab({ firmName }: { firmName: string }) {
  const [rows, setRows]       = useState<PEPortfolioCompany[] | null>(null);
  const [err, setErr]         = useState(false);

  useEffect(() => {
    setRows(null); setErr(false);
    fetchPEFirmPortfolio(firmName).then(setRows).catch(() => setErr(true));
  }, [firmName]);

  if (err) return <MissingDataState message="Failed to load this firm's portfolio." />;
  if (rows === null) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-[#F59E0B] animate-spin" /></div>;
  }
  if (rows.length === 0) {
    return <MissingDataState message="No portfolio companies are linked to this firm's PE Buyout or Secondary transactions yet." />;
  }

  const mature  = rows.filter(r => r.archetype === "mature_private");
  const growth  = rows.filter(r => r.archetype !== "mature_private");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Building2 className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Holdings — Mature Private</h3>
        </div>
        <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
          Scored on the mature-company track: absolute scale, longevity, and headcount stability
          (where holding steady is healthy), plus outbound M&A — not VC-style growth-rate metrics.
        </p>
        {mature.length === 0 ? (
          <MissingDataState message="None of this firm's linked holdings are classified Mature Private yet — classification updates as enrichment data lands." />
        ) : (
          <div className="overflow-x-auto rounded-[14px] border border-gray-100">
            <table className="w-full text-left" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["Company", "Employees", "Years Active", "Stability", "Acquisitions", "Held Since"].map(h => (
                    <th key={h} className="py-2.5 px-4 text-[9px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mature.map(c => {
                  const stab = c.growth_trend ? STABILITY_BADGE[c.growth_trend] : null;
                  return (
                    <tr key={c.startup_id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 px-4">
                        <div className="text-xs font-bold text-gray-900 leading-tight">{c.name}</div>
                        <div className="text-[10px] text-gray-400">{[c.industry, c.country].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-gray-700">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3 text-gray-300" />{fmtEmp(c.employee_count)}</span>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-gray-700">{c.years_active != null ? `${c.years_active} yrs` : "—"}</td>
                      <td className="py-3 px-4">
                        {stab
                          ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${stab.cls}`}>{stab.label}</span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-gray-700">{c.n_acquisitions > 0 ? c.n_acquisitions : "—"}</td>
                      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(c.first_deal_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {growth.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Growth Equity Positions</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {growth.map(c => (
              <span key={c.startup_id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full px-3.5 py-2 text-sm font-semibold text-gray-900">
                <Building2 className="w-3.5 h-3.5 text-gray-400 flex-none" />{c.name}
                <span className="text-[10px] font-medium text-gray-400">{fmtEmp(c.employee_count)} emp</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tearsheet: Transactions tab ──────────────────────────────────────────────

function PETransactionsTab({ firmName }: { firmName: string }) {
  const [rows, setRows] = useState<PETransaction[] | null>(null);
  const [err, setErr]   = useState(false);

  useEffect(() => {
    setRows(null); setErr(false);
    fetchPEFirmTransactions(firmName).then(setRows).catch(() => setErr(true));
  }, [firmName]);

  if (err) return <MissingDataState message="Failed to load this firm's transactions." />;
  if (rows === null) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-[#F59E0B] animate-spin" /></div>;
  }
  if (rows.length === 0) {
    return <MissingDataState message="No PE Buyout or Secondary transactions are on record for this firm yet." />;
  }

  return (
    <div className="space-y-2">
      {rows.map(t => (
        <div key={t.round_id} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-[12px] px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-none ${DEAL_STYLE[t.round_type] ?? "bg-gray-50 text-gray-500 border border-gray-100"}`}>
              {t.round_type}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold text-gray-900 leading-tight truncate">{t.company_name}</div>
              <div className="text-[10px] text-gray-400 truncate">{t.industry ?? "—"}</div>
            </div>
            {t.is_lead && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex-none">
                <Zap className="w-2.5 h-2.5" />Lead
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 flex-none">
            <span className="text-xs font-bold text-gray-900 whitespace-nowrap">{fmt(t.amount_raised)}</span>
            <span className="text-[10px] text-gray-400 whitespace-nowrap flex items-center gap-1">
              <Clock className="w-3 h-3" />{fmtDate(t.announcement_date)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tearsheet modal (identical structure to the Startups tearsheet) ──────────

type PETab = "overview" | "portfolio" | "transactions";

const PE_TABS: { id: PETab; label: string }[] = [
  { id: "overview",     label: "Overview" },
  { id: "portfolio",    label: "Portfolio" },
  { id: "transactions", label: "Transactions" },
];

function PETearsheetModal({ firm, onClose }: { firm: PEFirmRow; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<PETab>("overview");

  useEffect(() => { setActiveTab("overview"); }, [firm.firm_name]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(6,13,25,0.55)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-[90vw] max-w-6xl bg-white"
        style={{
          height: "85vh",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: 24,
          boxShadow: "0 32px 80px rgba(15,23,42,0.35), 0 0 0 1px rgba(15,23,42,0.02)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Fixed header (blue-gray — same as the Startups tearsheet) ── */}
        <div className="flex-none px-6 pt-5 pb-4 rounded-t-[24px]"
          style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
          <div className="flex items-start gap-4">
            <CompanyLogo name={firm.firm_name} website={firm.website} size={52} rounded="rounded-2xl" />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black text-[#0F172A] tracking-tight leading-none mb-1.5 truncate">{firm.firm_name}</h2>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#0F172A]/60">
                {firm.headquarters && (
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3 flex-none" />{firm.headquarters}</span>
                )}
                {firm.founded_year && (
                  <>
                    <span className="text-[#0F172A]/30">·</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3 flex-none" />Est. {firm.founded_year}</span>
                  </>
                )}
                {firm.website && (
                  <>
                    <span className="text-[#0F172A]/30">·</span>
                    <a href={firm.website} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 hover:text-cyan-700 transition-colors">
                      <Globe className="w-3 h-3 flex-none" />Website
                    </a>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-none">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap bg-white/70" style={{ border: "1px solid rgba(15,23,42,0.12)" }}>
                Private Equity
              </span>
              <button
                onClick={onClose}
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#0F172A]/50 hover:text-[#0F172A] transition-all"
                style={{ background: "rgba(255,255,255,0)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.35)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0)")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Tab bar (same blue-gray, slightly deeper) ── */}
        <div className="flex-none" style={{ background: "#AFC2CB", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
          <div className="flex items-center overflow-x-auto px-4" style={{ scrollbarWidth: "none" }}>
            {PE_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative flex-none px-4 py-3.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors"
                  style={{ color: active ? "#0F172A" : "rgba(15,23,42,0.55)" }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "rgba(15,23,42,0.8)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "rgba(15,23,42,0.55)"; }}
                >
                  {tab.label}
                  {active && (
                    <span
                      className="absolute bottom-0 inset-x-2 h-[2px] rounded-full"
                      style={{ background: "#0F172A" }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Scrollable tab content (white) ── */}
        <div
          className="flex-1 overflow-y-auto px-6 py-5 bg-white"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(15,23,42,0.15) transparent" }}
        >
          {activeTab === "overview"     && <PEOverviewTab firm={firm} />}
          {activeTab === "portfolio"    && <PEPortfolioTab firmName={firm.firm_name} />}
          {activeTab === "transactions" && <PETransactionsTab firmName={firm.firm_name} />}
        </div>
      </div>
    </div>
  );
}

// ─── Filters + sort ───────────────────────────────────────────────────────────

type DealType = "PE Buyout" | "Secondary";

interface Filters {
  dealTypes:  DealType[];
  aumStep:    AumStep;
  activeOnly: boolean;   // at least one deal in the last 24 months
}

const DEFAULT_FILTERS: Filters = { dealTypes: [], aumStep: "all", activeOnly: false };

type SortKey = "deals" | "portfolio" | "aum" | "latest";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "deals",     label: "Most Deals"  },
  { key: "portfolio", label: "Portfolio"   },
  { key: "aum",       label: "AUM"         },
  { key: "latest",    label: "Latest Deal" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export function PrivateEquity() {
  const [firms, setFirms]           = useState<PEFirmRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [filters, setFilters]       = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey]       = useState<SortKey>("deals");
  const [viewMode, setViewMode]     = useState<"grid" | "list">("grid");
  const [page, setPage]             = useState(1);
  const [selected, setSelected]     = useState<PEFirmRow | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchPEFirms()
      .then(setFirms)
      .catch(err => setFetchError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { setPage(1); }, [search, filters, sortKey]);

  const activeFilterCount = [
    search,
    filters.dealTypes.length > 0 ? "1" : "",
    filters.aumStep !== "all" ? "1" : "",
    filters.activeOnly ? "1" : "",
  ].filter(Boolean).length;

  function clearAll() {
    setSearch("");
    setFilters(DEFAULT_FILTERS);
  }

  const filtered = useMemo<PEFirmRow[]>(() => {
    let result = [...firms];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(f =>
        f.firm_name.toLowerCase().includes(q) ||
        (f.headquarters ?? "").toLowerCase().includes(q)
      );
    }

    if (filters.dealTypes.length > 0) {
      result = result.filter(f =>
        (filters.dealTypes.includes("PE Buyout") && f.buyout_count > 0) ||
        (filters.dealTypes.includes("Secondary") && f.secondary_count > 0)
      );
    }

    if (filters.aumStep !== "all") {
      result = result.filter(f => {
        const m = parseAumMillions(f.fund_size);
        if (m === null) return false;
        if (filters.aumStep === "sub1b")  return m < 1_000;
        if (filters.aumStep === "mid")    return m >= 1_000  && m < 10_000;
        if (filters.aumStep === "large")  return m >= 10_000 && m < 50_000;
        if (filters.aumStep === "mega")   return m >= 50_000;
        return true;
      });
    }

    if (filters.activeOnly) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      result = result.filter(f => f.latest_deal_date != null && new Date(f.latest_deal_date) >= cutoff);
    }

    result.sort((a, b) => {
      if (sortKey === "deals")     return (b.buyout_count + b.secondary_count) - (a.buyout_count + a.secondary_count);
      if (sortKey === "portfolio") return b.portfolio_count - a.portfolio_count;
      if (sortKey === "aum")       return (parseAumMillions(b.fund_size) ?? -1) - (parseAumMillions(a.fund_size) ?? -1);
      return (b.latest_deal_date ?? "").localeCompare(a.latest_deal_date ?? "");
    });

    return result;
  }, [firms, search, filters, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage  = Math.min(page, pageCount);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const aumLabel  = AUM_STEPS.find(s => s.value === filters.aumStep)?.label ?? "All";

  return (
    <Layout>

      {/* ── Filter bar (blue-gray — matches the VC directory) ─────────────── */}
      <div style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-6 pb-6">

          {/* Title row */}
          <div className="flex items-center justify-between gap-4 mb-1.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
              Private Equity
            </h1>

            <div className="flex items-center gap-2 flex-none">
              {/* View toggle — same control as the Startups hub */}
              <div className="flex items-center bg-white/60 border border-black/10 rounded-[10px] p-0.5 gap-0.5">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 rounded-[7px] transition-all ${viewMode === "grid" ? "bg-[#0F172A] text-white shadow-sm" : "text-[#0F172A]/60 hover:text-[#0F172A]"}`}
                  aria-label="Grid view"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-1.5 rounded-[7px] transition-all ${viewMode === "list" ? "bg-[#0F172A] text-white shadow-sm" : "text-[#0F172A]/60 hover:text-[#0F172A]"}`}
                  aria-label="List view"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>

              <span className="text-[10px] font-bold text-[#0F172A]/50 uppercase tracking-wider hidden sm:block">Sort</span>
              <div className="flex items-center bg-white/60 border border-black/10 rounded-[10px] p-0.5 gap-0.5">
                {SORT_OPTIONS.map(o => (
                  <button
                    key={o.key}
                    onClick={() => setSortKey(o.key)}
                    className={`px-2.5 py-1.5 rounded-[7px] text-[10px] font-semibold transition-all whitespace-nowrap ${
                      sortKey === o.key
                        ? "bg-[#0F172A] text-white shadow-sm"
                        : "text-[#0F172A]/60 hover:text-[#0F172A]"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Subtitle + count */}
          <div className="flex items-center gap-3 mb-5">
            <p className="text-sm text-[#0F172A]/60 leading-snug">
              Buyout and secondary-market intelligence — firms derived from real transaction data, scored on mature-market fundamentals.
            </p>
            {!loading && (
              <span className="text-xs font-semibold text-[#0F172A]/60 bg-white/60 border border-black/10 px-2.5 py-1 rounded-full flex-none">
                {filtered.length}
              </span>
            )}
          </div>

          {/* Screener */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">

              {/* Search */}
              <div className="relative min-w-[180px] max-w-xs flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0F172A]/40" />
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search firms…"
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-black/10 text-[#0F172A] placeholder-[#0F172A]/35 rounded-[12px] focus:outline-none focus:border-[#0F172A]/30 focus:ring-2 focus:ring-[#0F172A]/10 transition-all"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0F172A]/40 hover:text-[#0F172A]/70"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Deal-type pills */}
              {(["PE Buyout", "Secondary"] as DealType[]).map(d => (
                <button
                  key={d}
                  onClick={() => setFilters(f => ({ ...f, dealTypes: toggle(f.dealTypes, d) }))}
                  className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition-all whitespace-nowrap ${
                    filters.dealTypes.includes(d)
                      ? "bg-[#0F172A] text-white border-[#0F172A] shadow-sm"
                      : "bg-white/60 border-black/10 text-[#0F172A]/60 hover:border-black/25 hover:text-[#0F172A]"
                  }`}
                >
                  {d === "PE Buyout" ? "Buyouts" : "Secondaries"}
                </button>
              ))}

              <div className="w-px h-5 bg-black/10 flex-none hidden sm:block" />

              {/* Recent activity toggle */}
              <button
                onClick={() => setFilters(f => ({ ...f, activeOnly: !f.activeOnly }))}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-xs font-semibold border transition-all ${
                  filters.activeOnly
                    ? "bg-emerald-50 border-emerald-400/60 text-emerald-700"
                    : "bg-white/60 border-black/10 text-[#0F172A]/60 hover:border-black/25 hover:text-[#0F172A]"
                }`}
              >
                <Activity className={`w-3.5 h-3.5 flex-none ${filters.activeOnly ? "text-emerald-600" : "text-[#0F172A]/40"}`} />
                Active (24 mo)
                {filters.activeOnly && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-none" />}
              </button>

              {activeFilterCount > 0 && (
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#0F172A]/50 hover:text-rose-600 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />Clear all ({activeFilterCount})
                </button>
              )}
            </div>

            {/* AUM slider */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 bg-white/50 border border-black/10 rounded-[14px] px-5 py-4">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-[#0F172A]/55 uppercase tracking-wider">
                    Assets Under Management
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-all ${
                    filters.aumStep !== "all"
                      ? "bg-amber-100 text-amber-700 border border-amber-300"
                      : "text-[#0F172A]/40"
                  }`}>
                    {aumLabel}
                  </span>
                </div>
                <StepSlider
                  steps={AUM_STEPS}
                  value={filters.aumStep}
                  onChange={v => setFilters(f => ({ ...f, aumStep: v as AumStep }))}
                />
              </div>
              <div className="hidden sm:flex items-center text-[11px] text-[#0F172A]/45 leading-relaxed">
                AUM comes from curated firm profiles; firms known only from transaction data show "—" until a profile is added.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6">
        <div ref={gridRef}>
          {fetchError ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-sm font-semibold text-rose-500">Failed to load PE firms</p>
              <p className="mt-1 text-xs text-gray-400">{fetchError}</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-32">
              <Loader2 className="w-6 h-6 text-[#F59E0B] animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 bg-gray-100 border border-gray-200">
                <Landmark className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-sm font-semibold text-gray-500">
                {firms.length === 0
                  ? "No PE firms on record yet — they appear as PE Buyout / Secondary transactions land in the database."
                  : "No firms match these filters"}
              </p>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAll}
                  className="mt-3 text-xs font-semibold text-gray-500 hover:text-rose-600 transition-colors"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : viewMode === "grid" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {paginated.map(firm => (
                  <PEFirmCard key={firm.firm_name} firm={firm} onClick={() => setSelected(firm)} />
                ))}
              </div>
              <Pagination page={safePage} pageCount={pageCount} onChange={p => { setPage(p); gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
            </>
          ) : (
            <>
              <div className="overflow-x-auto rounded-[16px] border border-gray-200 bg-white">
                <table className="w-full text-left" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {["Firm", "HQ", "AUM", "Buyouts", "Secondaries", "Portfolio", "Latest Deal", ""].map(h => (
                        <th key={h} className="py-3 px-4 first:px-5 text-[9px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(firm => (
                      <tr
                        key={firm.firm_name}
                        onClick={() => setSelected(firm)}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <CompanyLogo name={firm.firm_name} website={firm.website} size={32} rounded="rounded-lg" />
                            <div className="text-sm font-bold text-[#0F172A] leading-tight">{firm.firm_name}</div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-gray-500">{firm.headquarters ?? "—"}</td>
                        <td className="py-3.5 px-4 text-sm font-bold text-[#0F172A]">{formatAUM(parseAumMillions(firm.fund_size))}</td>
                        <td className="py-3.5 px-4 text-xs font-semibold text-gray-700">{firm.buyout_count || "—"}</td>
                        <td className="py-3.5 px-4 text-xs font-semibold text-gray-700">{firm.secondary_count || "—"}</td>
                        <td className="py-3.5 px-4 text-xs font-semibold text-gray-700">{firm.portfolio_count || "—"}</td>
                        <td className="py-3.5 px-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(firm.latest_deal_date)}</td>
                        <td className="py-3.5 px-4 text-right text-gray-300 group-hover:text-[#0F172A] transition-colors text-sm">→</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={safePage} pageCount={pageCount} onChange={p => { setPage(p); gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
            </>
          )}
        </div>
      </div>

      {selected && (
        <PETearsheetModal firm={selected} onClose={() => setSelected(null)} />
      )}
    </Layout>
  );
}
