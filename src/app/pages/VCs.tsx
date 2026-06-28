import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  TrendingUp, Globe, Star, ExternalLink, X, DollarSign, Briefcase, Activity,
  ChevronLeft, ChevronRight, ChevronDown, Search, Zap,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { fetchInvestors, type InvestorRow } from "../../lib/supabase";
import { VCModal } from "../components/VCModal";
import { DonutFocusChart } from "../components/DonutFocusChart";
import { CompanyLogo } from "../components/CompanyLogo";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage     = "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Growth";
type Geography = "North America" | "Europe" | "Israel" | "Asia-Pacific" | "Global" | "MENA";

interface SectorWeight { sector: string; weight: number }

export interface VCFirm {
  id:                 string;
  name:               string;
  slug:               string;
  tagline:            string;
  description:        string;
  aum_millions:       number | null;
  fund_size:          string | null;
  typical_check_size: string | null;
  founded_year:       number;
  headquarters:       string;
  geography:          Geography[];
  stages:             Stage[];
  sectors:            string[];
  portfolio_count:    number;
  recent_investments: number;
  notable_exits:      string[];
  website:            string;
  sector_weights:     SectorWeight[];
}

// ─── DB → VCFirm mapper ──────────────────────────────────────────────────────

function parseAumMillions(fundSize: string | null): number | null {
  if (!fundSize) return null;
  const b = fundSize.match(/\$?([\d.]+)B/i);
  if (b) return Math.round(parseFloat(b[1]) * 1_000);
  const m = fundSize.match(/\$?([\d.]+)M/i);
  if (m) return Math.round(parseFloat(m[1]));
  return null;
}

function deriveGeography(hq: string | null): Geography[] {
  if (!hq) return ["Global"];
  const l = hq.toLowerCase();
  if (l.includes("uk") || l.includes("london") || l.includes("berlin") || l.includes("paris")) return ["Europe"];
  if (l.includes("israel") || l.includes("tel aviv")) return ["Israel"];
  if (l.includes("beijing") || l.includes("shanghai") || l.includes("singapore") || l.includes("tokyo")) return ["Asia-Pacific"];
  if (l.includes("dubai") || l.includes("riyadh")) return ["MENA"];
  return ["North America", "Global"];
}

function rowToFirm(row: InvestorRow): VCFirm {
  const alloc = row.sector_allocation ?? {};
  const sector_weights: SectorWeight[] = Object.entries(alloc).map(([sector, weight]) => ({ sector, weight }));
  const sectors = sector_weights.filter(sw => sw.weight > 55).map(sw => sw.sector);
  const firstSentence = (row.description ?? "").split(/\.\s/)[0];
  const tagline = firstSentence.length > 60 ? firstSentence.slice(0, 57) + "…" : firstSentence;

  return {
    id:                 row.slug ?? row.id,
    name:               row.name,
    slug:               row.slug,
    tagline,
    description:        row.description ?? "",
    aum_millions:       parseAumMillions(row.fund_size),
    fund_size:          row.fund_size,
    typical_check_size: row.typical_check_size,
    founded_year:       row.founded_year ?? 0,
    headquarters:       row.headquarters ?? "—",
    geography:          deriveGeography(row.headquarters),
    stages:             (row.stages ?? []) as Stage[],
    sectors,
    portfolio_count:    row.portfolio_size ?? 0,
    recent_investments: Math.max(1, Math.round((row.portfolio_size ?? 50) / 40)),
    notable_exits:      row.notable_investments ?? [],
    website:            row.website ?? "#",
    sector_weights,
  };
}

// ─── Slider step definitions ──────────────────────────────────────────────────

const CHECK_SIZE_STEPS = [
  { value: "all",       label: "All"       },
  { value: "micro",     label: "< $500K"   },
  { value: "seed",      label: "$500K–$2M" },
  { value: "series-a",  label: "$2M–$10M"  },
  { value: "growth",    label: "$10M+"     },
] as const;
type CheckStep = typeof CHECK_SIZE_STEPS[number]["value"];

const AUM_STEPS = [
  { value: "all",   label: "All"         },
  { value: "micro", label: "< $100M"     },
  { value: "small", label: "$100M–$500M" },
  { value: "mid",   label: "$500M–$2B"   },
  { value: "large", label: "$2B+"        },
] as const;
type AumStep = typeof AUM_STEPS[number]["value"];

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE   = 50;
const ALL_STAGES: Stage[]    = ["Pre-Seed", "Seed", "Series A", "Series B", "Growth"];
const ALL_SECTORS             = ["AI", "Fintech", "Cyber", "SaaS", "HealthTech", "FoodTech"];
const GEO_OPTIONS: Geography[] = ["North America", "Europe", "Israel", "Asia-Pacific", "Global", "MENA"];

const STAGE_PILL: Record<Stage, string> = {
  "Pre-Seed": "bg-violet-500/10 text-violet-300 border border-violet-500/20",
  "Seed":     "bg-sky-500/10 text-sky-300 border border-sky-500/20",
  "Series A": "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20",
  "Series B": "bg-amber-500/10 text-amber-300 border border-amber-500/20",
  "Growth":   "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20",
};

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortKey = "recent_investments" | "portfolio_count" | "aum_millions" | "founded_year";
type SortDir = "desc" | "asc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent_investments", label: "Most Active" },
  { key: "portfolio_count",    label: "Portfolio"   },
  { key: "aum_millions",       label: "AUM"         },
  { key: "founded_year",       label: "Founded"     },
];

// ─── Accent palette ───────────────────────────────────────────────────────────

interface AccentConfig {
  radarStroke:  string;
  radarFill:    string;
  gridStroke:   string;
  avatarFrom:   string;
  avatarTo:     string;
  avatarText:   string;
  glowColor:    string;
  borderHover:  string;
  shimmerColor: string;
}

const ACCENT_PALETTE: AccentConfig[] = [
  {
    radarStroke: "#22d3ee", radarFill: "rgba(34,211,238,0.13)", gridStroke: "rgba(34,211,238,0.18)",
    avatarFrom: "#0e4f5e", avatarTo: "#0a3040", avatarText: "#67e8f9",
    glowColor: "rgba(34,211,238,0.10)", borderHover: "rgba(34,211,238,0.22)", shimmerColor: "rgba(34,211,238,0.35)",
  },
  {
    radarStroke: "#a78bfa", radarFill: "rgba(167,139,250,0.13)", gridStroke: "rgba(139,92,246,0.18)",
    avatarFrom: "#3b1f72", avatarTo: "#1e1040", avatarText: "#c4b5fd",
    glowColor: "rgba(139,92,246,0.10)", borderHover: "rgba(167,139,250,0.22)", shimmerColor: "rgba(167,139,250,0.35)",
  },
  {
    radarStroke: "#34d399", radarFill: "rgba(52,211,153,0.13)", gridStroke: "rgba(16,185,129,0.18)",
    avatarFrom: "#064e33", avatarTo: "#042a1c", avatarText: "#6ee7b7",
    glowColor: "rgba(16,185,129,0.10)", borderHover: "rgba(52,211,153,0.22)", shimmerColor: "rgba(52,211,153,0.35)",
  },
  {
    radarStroke: "#fbbf24", radarFill: "rgba(251,191,36,0.13)", gridStroke: "rgba(245,158,11,0.18)",
    avatarFrom: "#5c3d0a", avatarTo: "#2d1d04", avatarText: "#fcd34d",
    glowColor: "rgba(245,158,11,0.10)", borderHover: "rgba(251,191,36,0.22)", shimmerColor: "rgba(251,191,36,0.35)",
  },
];

function getAccent(id: string): AccentConfig {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return ACCENT_PALETTE[h % ACCENT_PALETTE.length];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAUM(m: number | null): string {
  if (m == null) return "—";
  return m >= 1_000 ? `$${(m / 1_000).toFixed(1)}B` : `$${m}M`;
}

function firmInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function parseCheckSizeDollars(str: string | null): number | null {
  if (!str) return null;
  const m = str.match(/\$?([\d.]+)\s*([KMB]?)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  if (u === "K") return n * 1_000;
  if (u === "M") return n * 1_000_000;
  if (u === "B") return n * 1_000_000_000;
  return n;
}

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
}

// ─── Filter state ─────────────────────────────────────────────────────────────

interface Filters {
  stages:    Stage[];
  sectors:   string[];
  geo:       Geography | "";
  checkStep: CheckStep;
  aumStep:   AumStep;
  leadOnly:  boolean;
}

const DEFAULT_FILTERS: Filters = {
  stages: [], sectors: [], geo: "",
  checkStep: "all", aumStep: "all", leadOnly: false,
};

// ─── StepSlider (dark variant — matches Startups screener) ───────────────────

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
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-[#1a2a3f]" />
        <div
          className="absolute left-0 h-[3px] rounded-full bg-[#F59E0B] transition-all duration-100"
          style={{ width: `${pct}%` }}
        />
        {steps.map((_, i) => (
          <div
            key={i}
            className={`absolute w-2.5 h-2.5 rounded-full border-[2px] -translate-x-1/2 transition-all duration-100 ${
              i < idx   ? "bg-[#F59E0B] border-[#F59E0B]" :
              i === idx ? "bg-white border-[#F59E0B] scale-125" :
                          "bg-[#0d1f35] border-[#243858]"
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
              i === idx ? "text-[#F59E0B]" : "text-slate-500 hover:text-slate-300"
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

// ─── VCCard ───────────────────────────────────────────────────────────────────

function VCCard({ firm, onClick }: { firm: VCFirm; onClick: () => void }) {
  const accent = getAccent(firm.id);

  return (
    <div
      className="relative group flex flex-col overflow-hidden rounded-[22px] border transition-all duration-300 cursor-pointer select-none"
      onClick={onClick}
      style={{
        background: "linear-gradient(145deg, #1a2535 0%, #0c1524 100%)",
        borderColor: "rgba(255,255,255,0.07)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
        willChange: "transform",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget;
        el.style.transform = "translateY(-4px)";
        el.style.borderColor = accent.borderHover;
        el.style.boxShadow = `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px ${accent.borderHover}, ${accent.glowColor} 0px 0px 60px 0px, inset 0 1px 0 rgba(255,255,255,0.06)`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget;
        el.style.transform = "";
        el.style.borderColor = "rgba(255,255,255,0.07)";
        el.style.boxShadow = "0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)";
      }}
    >
      {/* Top shimmer accent line */}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{ background: `linear-gradient(90deg, transparent, ${accent.shimmerColor}, transparent)` }}
      />

      {/* Ambient glow orb */}
      <div
        className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-3xl"
        style={{ background: accent.glowColor }}
      />

      {/* Card header */}
      <div className="px-5 pt-5 pb-4 relative z-10">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <CompanyLogo name={firm.name} website={firm.website} size={44} rounded="rounded-xl" />
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-white truncate leading-tight tracking-tight">
                {firm.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1 leading-tight">
                {firm.tagline}
              </p>
            </div>
          </div>

          <a
            href={firm.website}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex-none p-1.5 rounded-lg text-slate-600 hover:text-slate-300 transition-colors"
            aria-label={`Visit ${firm.name}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="flex flex-wrap gap-1">
          {firm.stages.map(s => (
            <span key={s} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STAGE_PILL[s]}`}>
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Donut focus chart */}
      <div className="px-4 pb-1 relative z-10">
        <div
          className="relative overflow-hidden rounded-[14px]"
          style={{ background: "rgba(5,10,20,0.7)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          {(["top-2 left-2 border-t border-l", "top-2 right-2 border-t border-r",
             "bottom-2 left-2 border-b border-l", "bottom-2 right-2 border-b border-r"] as const
          ).map((cls, i) => (
            <div
              key={i}
              className={`absolute w-3 h-3 pointer-events-none ${cls}`}
              style={{ borderColor: accent.shimmerColor, opacity: 0.6 }}
            />
          ))}

          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600 text-center pt-3 pb-0.5">
            Focus Areas
          </p>

          <DonutFocusChart data={firm.sector_weights} accentColor={accent.radarStroke} height={190} />
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-1.5 px-4 py-3 relative z-10">
        <div className="rounded-[10px] px-2.5 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-1 mb-1">
            <DollarSign className="w-2.5 h-2.5 text-emerald-500 flex-none" />
            <span className="text-[8.5px] font-bold text-slate-600 uppercase tracking-wider">AUM</span>
          </div>
          <div className="text-sm font-bold text-emerald-400 leading-none">{formatAUM(firm.aum_millions)}</div>
        </div>

        <div className="rounded-[10px] px-2.5 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-1 mb-1">
            <Briefcase className="w-2.5 h-2.5 text-cyan-500 flex-none" />
            <span className="text-[8.5px] font-bold text-slate-600 uppercase tracking-wider">Portfolio</span>
          </div>
          <div className="text-sm font-bold text-cyan-400 leading-none">{firm.portfolio_count}</div>
        </div>

        <div className="rounded-[10px] px-2.5 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-1 mb-1">
            <Activity className="w-2.5 h-2.5 text-amber-500 flex-none" />
            <span className="text-[8.5px] font-bold text-slate-600 uppercase tracking-wider">Deals/yr</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-amber-400 flex-none" />
            <span className="text-sm font-bold text-amber-400 leading-none">{firm.recent_investments}</span>
          </div>
        </div>
      </div>

      {/* Notable exits */}
      <div className="px-5 pb-4 relative z-10">
        <div className="flex items-center gap-1.5 mb-2">
          <Star className="w-3 h-3" style={{ color: accent.radarStroke }} />
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">Notable Exits</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {firm.notable_exits.slice(0, 4).map(exit => (
            <span
              key={exit}
              className="px-2 py-0.5 text-[10px] font-semibold rounded-full text-slate-300"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {exit}
            </span>
          ))}
          {firm.notable_exits.length > 4 && (
            <span
              className="px-2 py-0.5 text-[10px] rounded-full text-slate-600"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
            >
              +{firm.notable_exits.length - 4}
            </span>
          )}
        </div>
      </div>

      {/* Card footer */}
      <div
        className="px-5 py-3 mt-auto flex items-center justify-between gap-2 relative z-10"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Globe className="w-3 h-3 text-slate-600 flex-none" />
          <span className="text-[10px] text-slate-600 truncate">{firm.geography.slice(0, 2).join(", ")}</span>
        </div>
        <span className="text-[10px] text-slate-700 font-medium flex-none">Est. {firm.founded_year}</span>
      </div>
    </div>
  );
}

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="rounded-[22px] border overflow-hidden animate-pulse"
      style={{ background: "linear-gradient(145deg, #1a2535 0%, #0c1524 100%)", borderColor: "rgba(255,255,255,0.07)", height: 420 }}
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl flex-none" style={{ background: "rgba(255,255,255,0.06)" }} />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 rounded-full w-2/3" style={{ background: "rgba(255,255,255,0.06)" }} />
            <div className="h-2.5 rounded-full w-1/2" style={{ background: "rgba(255,255,255,0.04)" }} />
          </div>
        </div>
        <div className="flex gap-1">
          {[40, 52, 44].map(w => (
            <div key={w} className="h-4 rounded-full" style={{ width: w, background: "rgba(255,255,255,0.05)" }} />
          ))}
        </div>
      </div>
      <div className="mx-4 rounded-[14px] h-[200px]" style={{ background: "rgba(5,10,20,0.7)", border: "1px solid rgba(255,255,255,0.05)" }} />
      <div className="grid grid-cols-3 gap-1.5 px-4 py-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-14 rounded-[10px]" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }} />
        ))}
      </div>
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

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

// ─── Main Page ────────────────────────────────────────────────────────────────

export function VCs() {
  const [firms, setFirms]           = useState<VCFirm[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [filters, setFilters]       = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey]       = useState<SortKey>("recent_investments");
  const [sortDir, setSortDir]       = useState<SortDir>("desc");
  const [page, setPage]             = useState(1);
  const [selectedFirm, setSelectedFirm] = useState<VCFirm | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchInvestors()
      .then(rows  => setFirms(rows.map(rowToFirm)))
      .catch(err  => setFetchError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { setPage(1); }, [search, filters, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function handlePageChange(p: number) {
    setPage(p);
    gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearAll() {
    setSearch("");
    setFilters(DEFAULT_FILTERS);
  }

  const activeFilterCount = [
    search,
    filters.stages.length  > 0 ? "1" : "",
    filters.sectors.length > 0 ? "1" : "",
    filters.geo,
    filters.checkStep !== "all" ? "1" : "",
    filters.aumStep   !== "all" ? "1" : "",
    filters.leadOnly ? "1" : "",
  ].filter(Boolean).length;

  const filtered = useMemo<VCFirm[]>(() => {
    let result = [...firms];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(v =>
        v.name.toLowerCase().includes(q) ||
        v.headquarters.toLowerCase().includes(q) ||
        v.sectors.some(s => s.toLowerCase().includes(q))
      );
    }

    if (filters.stages.length > 0) {
      const sel = filters.stages.map(s => s.toLowerCase());
      result = result.filter(v => v.stages.some(s => sel.includes(s.toLowerCase())));
    }

    if (filters.sectors.length > 0) {
      const sel = filters.sectors.map(s => s.toLowerCase());
      result = result.filter(v => v.sectors.some(s => sel.includes(s.toLowerCase())));
    }

    if (filters.geo) {
      const g = filters.geo.toLowerCase();
      result = result.filter(v => v.geography.some(x => x.toLowerCase() === g));
    }

    if (filters.checkStep !== "all") {
      result = result.filter(v => {
        const d = parseCheckSizeDollars(v.typical_check_size);
        if (d === null) return false;
        if (filters.checkStep === "micro")    return d < 500_000;
        if (filters.checkStep === "seed")     return d >= 500_000    && d < 2_000_000;
        if (filters.checkStep === "series-a") return d >= 2_000_000  && d < 10_000_000;
        if (filters.checkStep === "growth")   return d >= 10_000_000;
        return true;
      });
    }

    if (filters.aumStep !== "all") {
      result = result.filter(v => {
        const m = v.aum_millions;
        if (m === null) return false;
        if (filters.aumStep === "micro")  return m < 100;
        if (filters.aumStep === "small")  return m >= 100  && m < 500;
        if (filters.aumStep === "mid")    return m >= 500  && m < 2_000;
        if (filters.aumStep === "large")  return m >= 2_000;
        return true;
      });
    }

    if (filters.leadOnly) {
      result = result.filter(v =>
        v.stages.some(s => s === "Pre-Seed" || s === "Seed" || s === "Series A")
      );
    }

    result.sort((a, b) => {
      const raw = (v: VCFirm) => {
        const n = v[sortKey] as number | null | undefined;
        return n == null || isNaN(n as number) ? 0 : n;
      };
      return sortDir === "desc" ? raw(b) - raw(a) : raw(a) - raw(b);
    });

    return result;
  }, [firms, search, filters, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage  = Math.min(page, pageCount);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const checkLabel = CHECK_SIZE_STEPS.find(s => s.value === filters.checkStep)?.label ?? "All";
  const aumLabel   = AUM_STEPS.find(s => s.value === filters.aumStep)?.label ?? "All";

  return (
    <Layout>

      {/* ── Dark header band (matches Startups page) ────────────────────── */}
      <div className="bg-[#0b1626] border-b border-[#1a2a3f]">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-6 pb-6">

          {/* Title row */}
          <div className="flex items-center justify-between gap-4 mb-1.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              VC Directory
            </h1>

            {/* Sort segmented control */}
            <div className="flex items-center gap-2 flex-none">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider hidden sm:block">Sort</span>
              <div className="flex items-center bg-[#0d1f35] border border-[#1a2a3f] rounded-[10px] p-0.5 gap-0.5">
                {SORT_OPTIONS.map(o => (
                  <button
                    key={o.key}
                    onClick={() => handleSort(o.key)}
                    className={`px-2.5 py-1.5 rounded-[7px] text-[10px] font-semibold transition-all whitespace-nowrap ${
                      sortKey === o.key
                        ? "bg-[#F59E0B] text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {o.label}
                    {sortKey === o.key && (
                      <span className="ml-0.5 opacity-70">{sortDir === "desc" ? "↓" : "↑"}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Subtitle + count */}
          <div className="flex items-center gap-3 mb-5">
            <p className="text-sm text-slate-400 leading-snug">
              Institutional-grade intelligence on leading VC firms — sector focus, portfolio activity, and fund size.
            </p>
            {!loading && (
              <span className="text-xs font-semibold text-slate-500 bg-[#0d1f35] border border-[#1a2a3f] px-2.5 py-1 rounded-full flex-none">
                {filtered.length}
              </span>
            )}
          </div>

          {/* ── Screener ──────────────────────────────────────────────────── */}
          <div className="space-y-3">

            {/* Row 1: search + pill filters + dropdowns + toggles */}
            <div className="flex flex-wrap items-center gap-2.5">

              {/* Search */}
              <div className="relative min-w-[180px] max-w-xs flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search firms…"
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-[#0d1f35] border border-[#1a2a3f] text-white placeholder-slate-600 rounded-[12px] focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/10 transition-all"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Stage pills */}
              {ALL_STAGES.map(s => (
                <button
                  key={s}
                  onClick={() => setFilters(f => ({ ...f, stages: toggle(f.stages, s) }))}
                  className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition-all whitespace-nowrap ${
                    filters.stages.includes(s)
                      ? "bg-[#F59E0B] text-white border-[#F59E0B] shadow-sm"
                      : "bg-[#0d1f35] border-[#1a2a3f] text-slate-400 hover:border-slate-600 hover:text-slate-200"
                  }`}
                >
                  {s}
                </button>
              ))}

              {/* Vertical divider */}
              <div className="w-px h-5 bg-[#1a2a3f] flex-none hidden sm:block" />

              {/* Sector pills */}
              {ALL_SECTORS.map(s => (
                <button
                  key={s}
                  onClick={() => setFilters(f => ({ ...f, sectors: toggle(f.sectors, s) }))}
                  className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition-all whitespace-nowrap ${
                    filters.sectors.includes(s)
                      ? "bg-[#F59E0B] text-white border-[#F59E0B] shadow-sm"
                      : "bg-[#0d1f35] border-[#1a2a3f] text-slate-400 hover:border-slate-600 hover:text-slate-200"
                  }`}
                >
                  {s}
                </button>
              ))}

              {/* Vertical divider */}
              <div className="w-px h-5 bg-[#1a2a3f] flex-none hidden sm:block" />

              {/* Geography dropdown */}
              <div className="relative">
                <select
                  value={filters.geo}
                  onChange={e => setFilters(f => ({ ...f, geo: e.target.value as Geography | "" }))}
                  style={{ colorScheme: "dark" }}
                  className={`appearance-none pl-3 pr-8 py-2 text-xs font-semibold border rounded-[10px] bg-[#0d1f35] transition-all focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/20 cursor-pointer ${
                    filters.geo ? "border-[#F59E0B] text-white" : "border-[#1a2a3f] text-slate-400"
                  }`}
                >
                  <option value="">All Regions</option>
                  {GEO_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              </div>

              {/* Lead Investors toggle */}
              <button
                onClick={() => setFilters(f => ({ ...f, leadOnly: !f.leadOnly }))}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-xs font-semibold border transition-all ${
                  filters.leadOnly
                    ? "bg-emerald-900/40 border-emerald-700/60 text-emerald-400"
                    : "bg-[#0d1f35] border-[#1a2a3f] text-slate-400 hover:border-slate-600 hover:text-slate-200"
                }`}
              >
                <Zap className={`w-3.5 h-3.5 flex-none ${filters.leadOnly ? "text-emerald-400" : "text-slate-500"}`} />
                Lead Investors
                {filters.leadOnly && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-none" />}
              </button>

              {/* Clear all */}
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />Clear all ({activeFilterCount})
                </button>
              )}
            </div>

            {/* Row 2: range sliders for Check Size + AUM */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 bg-[#0d1f35] border border-[#1a2a3f] rounded-[14px] px-5 py-4">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Typical Check Size
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-all ${
                    filters.checkStep !== "all"
                      ? "bg-amber-900/40 text-amber-400 border border-amber-800/60"
                      : "text-slate-600"
                  }`}>
                    {checkLabel}
                  </span>
                </div>
                <StepSlider
                  steps={CHECK_SIZE_STEPS}
                  value={filters.checkStep}
                  onChange={v => setFilters(f => ({ ...f, checkStep: v as CheckStep }))}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Fund Size / AUM
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-all ${
                    filters.aumStep !== "all"
                      ? "bg-amber-900/40 text-amber-400 border border-amber-800/60"
                      : "text-slate-600"
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
            </div>

          </div>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6">
        <div ref={gridRef}>
          {fetchError ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-sm font-semibold text-rose-500">Failed to load investors</p>
              <p className="mt-1 text-xs text-gray-400">{fetchError}</p>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {[0, 1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 bg-gray-100 border border-gray-200">
                <X className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-sm font-semibold text-gray-500">No firms match these filters</p>
              <button
                onClick={clearAll}
                className="mt-3 text-xs font-semibold text-[#F59E0B] hover:text-amber-600 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {paginated.map(firm => (
                  <VCCard key={firm.id} firm={firm} onClick={() => setSelectedFirm(firm)} />
                ))}
              </div>
              <Pagination page={safePage} pageCount={pageCount} onChange={handlePageChange} />
            </>
          )}
        </div>
      </div>

      {selectedFirm && (
        <VCModal firm={selectedFirm} onClose={() => setSelectedFirm(null)} />
      )}
    </Layout>
  );
}
