import React, { useState, useMemo } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Building2,
  TrendingUp,
  Globe,
  Users,
  Star,
  ExternalLink,
  ChevronDown,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Layout } from "../components/Layout";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Stage = "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Growth";
type Geography = "North America" | "Europe" | "Israel" | "Asia-Pacific" | "Global" | "MENA";

interface SectorWeight {
  sector: string;
  weight: number;
}

// Supabase-ready — swap DUMMY_VCS for a real fetchVCs() call when ready
export interface VCFirm {
  id: string;
  name: string;
  tagline: string;
  description: string;
  aum_millions: number | null;
  founded_year: number;
  headquarters: string;
  geography: Geography[];
  stages: Stage[];
  sectors: string[];
  portfolio_count: number;
  recent_investments: number; // deals in last 12 months
  notable_exits: string[];
  website: string;
  sector_weights: SectorWeight[]; // radar chart axes
}

// ─── Dummy Data ────────────────────────────────────────────────────────────────

const DUMMY_VCS: VCFirm[] = [
  {
    id: "sequoia",
    name: "Sequoia Capital",
    tagline: "The Venture Partner for the Long Arc",
    description:
      "One of the most storied venture capital firms, backing the disruptors, the doers, and the dreamers who build legendary companies.",
    aum_millions: 85_000,
    founded_year: 1972,
    headquarters: "Menlo Park, CA",
    geography: ["North America", "Global"],
    stages: ["Seed", "Series A", "Series B", "Growth"],
    sectors: ["AI", "Fintech", "SaaS", "HealthTech", "Consumer"],
    portfolio_count: 250,
    recent_investments: 28,
    notable_exits: ["Apple", "Google", "Oracle", "Airbnb", "Zoom"],
    website: "https://sequoiacap.com",
    sector_weights: [
      { sector: "AI",        weight: 90 },
      { sector: "Fintech",   weight: 60 },
      { sector: "Cyber",     weight: 45 },
      { sector: "SaaS",      weight: 80 },
      { sector: "HealthTech",weight: 50 },
      { sector: "FoodTech",  weight: 20 },
    ],
  },
  {
    id: "a16z",
    name: "Andreessen Horowitz",
    tagline: "Software Is Eating the World",
    description:
      "A16z is a Silicon Valley-based venture capital firm committed to innovation. They back bold entrepreneurs building the future through technology.",
    aum_millions: 35_000,
    founded_year: 2009,
    headquarters: "Menlo Park, CA",
    geography: ["North America", "Global"],
    stages: ["Seed", "Series A", "Series B", "Growth"],
    sectors: ["AI", "Crypto", "Fintech", "SaaS", "Biotech"],
    portfolio_count: 180,
    recent_investments: 34,
    notable_exits: ["GitHub", "Lyft", "Coinbase", "Okta", "Databricks"],
    website: "https://a16z.com",
    sector_weights: [
      { sector: "AI",        weight: 95 },
      { sector: "Fintech",   weight: 75 },
      { sector: "Cyber",     weight: 55 },
      { sector: "SaaS",      weight: 85 },
      { sector: "HealthTech",weight: 40 },
      { sector: "FoodTech",  weight: 10 },
    ],
  },
  {
    id: "accel",
    name: "Accel Partners",
    tagline: "Built for Founders. Focused on the Future.",
    description:
      "Accel is a leading venture capital firm that invests in people and companies that will change the world. Their network spans Silicon Valley, London, and beyond.",
    aum_millions: 22_000,
    founded_year: 1983,
    headquarters: "Palo Alto, CA",
    geography: ["North America", "Europe", "Asia-Pacific"],
    stages: ["Seed", "Series A", "Series B"],
    sectors: ["SaaS", "Cyber", "Fintech", "AI", "Marketplaces"],
    portfolio_count: 320,
    recent_investments: 21,
    notable_exits: ["Facebook", "Slack", "Dropbox", "Spotify", "Atlassian"],
    website: "https://accel.com",
    sector_weights: [
      { sector: "AI",        weight: 70 },
      { sector: "Fintech",   weight: 65 },
      { sector: "Cyber",     weight: 85 },
      { sector: "SaaS",      weight: 95 },
      { sector: "HealthTech",weight: 30 },
      { sector: "FoodTech",  weight: 15 },
    ],
  },
  {
    id: "index-ventures",
    name: "Index Ventures",
    tagline: "Boldly Going Where Others Fear to Tread",
    description:
      "Index Ventures is a London and San Francisco-based international VC firm backing entrepreneurs who are reshaping industries with technology.",
    aum_millions: 8_500,
    founded_year: 1996,
    headquarters: "London, UK",
    geography: ["Europe", "North America", "Global"],
    stages: ["Seed", "Series A", "Series B", "Growth"],
    sectors: ["Fintech", "E-commerce", "Gaming", "SaaS", "Crypto"],
    portfolio_count: 170,
    recent_investments: 15,
    notable_exits: ["Skype", "King", "Robinhood", "Figma", "dbt Labs"],
    website: "https://indexventures.com",
    sector_weights: [
      { sector: "AI",        weight: 55 },
      { sector: "Fintech",   weight: 90 },
      { sector: "Cyber",     weight: 40 },
      { sector: "SaaS",      weight: 70 },
      { sector: "HealthTech",weight: 25 },
      { sector: "FoodTech",  weight: 35 },
    ],
  },
];

// ─── Constants ─────────────────────────────────────────────────────────────────

const ALL_STAGES: Stage[] = ["Pre-Seed", "Seed", "Series A", "Series B", "Growth"];
const ALL_SECTORS = ["AI", "Fintech", "Cyber", "SaaS", "HealthTech", "FoodTech"];
const ALL_GEOS: Geography[] = [
  "North America", "Europe", "Israel", "Asia-Pacific", "Global", "MENA",
];

// Stage badge styles — same as Startups ROUND_STYLE
const STAGE_STYLE: Record<Stage, string> = {
  "Pre-Seed":  "bg-purple-50 text-purple-700 border border-purple-100",
  "Seed":      "bg-blue-50 text-blue-700 border border-blue-100",
  "Series A":  "bg-emerald-50 text-emerald-700 border border-emerald-100",
  "Series B":  "bg-amber-50 text-amber-700 border border-amber-100",
  "Growth":    "bg-indigo-50 text-indigo-700 border border-indigo-100",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatAUM(millions: number | null): string {
  if (millions == null) return "Undisclosed";
  if (millions >= 1_000) return `$${(millions / 1_000).toFixed(1)}B`;
  return `$${millions}M`;
}

// ─── VCCard ────────────────────────────────────────────────────────────────────

function VCCard({ firm }: { firm: VCFirm }) {
  return (
    <div className="relative bg-[#0b1626] rounded-[20px] border border-[#1a2a3f] shadow-[0_2px_16px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)] hover:-translate-y-0.5 hover:border-[#243858] transition-all duration-200 flex flex-col overflow-hidden">

      {/* ── Card header ── */}
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#091422] border border-[#1a2a3f] flex items-center justify-center flex-none">
              <Building2 className="w-5 h-5 text-[#F59E0B]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-white truncate leading-tight">{firm.name}</h3>
              <p className="text-xs text-slate-400 font-medium mt-0.5 line-clamp-1">{firm.tagline}</p>
            </div>
          </div>
          <a
            href={firm.website}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex-none p-1.5 rounded-lg text-slate-600 hover:text-[#F59E0B] transition-colors"
            aria-label={`Visit ${firm.name} website`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Stage pills */}
        <div className="flex flex-wrap gap-1">
          {firm.stages.map((s) => (
            <span
              key={s}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STAGE_STYLE[s] ?? "bg-gray-50 text-gray-500 border border-gray-100"}`}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* ── Radar chart ── */}
      <div className="px-4 pb-1">
        <div className="bg-[#091422] border border-[#1a2a3f] rounded-[14px] px-2 pt-3 pb-1">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 text-center mb-1">
            Sector Focus
          </p>
          <div className="h-[188px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={firm.sector_weights} outerRadius="70%">
                <PolarGrid
                  stroke="#1a2a3f"
                  strokeDasharray="3 3"
                />
                <PolarAngleAxis
                  dataKey="sector"
                  tick={{ fill: "#94a3b8", fontSize: 10.5, fontWeight: 600 }}
                />
                <Radar
                  dataKey="weight"
                  stroke="#F59E0B"
                  fill="rgba(245,158,11,0.18)"
                  strokeWidth={1.8}
                  dot={{ fill: "#F59E0B", r: 2.5 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "#060e1a",
                    border: "1px solid #1a2a3f",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  itemStyle={{ color: "#F59E0B" }}
                  labelStyle={{ color: "#94a3b8", fontWeight: 600 }}
                  formatter={(v: number) => [`${v}%`, "Weight"]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Key stats row ── */}
      <div className="grid grid-cols-3 gap-2 px-4 py-3">
        <div className="bg-[#091422] rounded-[10px] px-3 py-2 border border-[#1a2a3f]">
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">AUM</div>
          <div className="text-sm font-bold text-white">{formatAUM(firm.aum_millions)}</div>
        </div>
        <div className="bg-[#091422] rounded-[10px] px-3 py-2 border border-[#1a2a3f]">
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Portfolio</div>
          <div className="text-sm font-bold text-white">{firm.portfolio_count}</div>
        </div>
        <div className="bg-[#091422] rounded-[10px] px-3 py-2 border border-[#1a2a3f]">
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Deals / yr</div>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-400 flex-none" />
            <span className="text-sm font-bold text-white">{firm.recent_investments}</span>
          </div>
        </div>
      </div>

      {/* ── Notable exits ── */}
      <div className="px-5 pb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Star className="w-3 h-3 text-[#F59E0B]" />
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Notable Exits</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {firm.notable_exits.slice(0, 4).map((e) => (
            <span
              key={e}
              className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-[#091422] border border-[#1a2a3f] text-slate-300"
            >
              {e}
            </span>
          ))}
          {firm.notable_exits.length > 4 && (
            <span className="px-2 py-0.5 text-[10px] rounded-full bg-[#091422] border border-[#1a2a3f] text-slate-500">
              +{firm.notable_exits.length - 4}
            </span>
          )}
        </div>
      </div>

      {/* ── Card footer ── */}
      <div className="px-5 py-3 border-t border-[#1a2a3f] flex items-center justify-between gap-2 mt-auto">
        <div className="flex items-center gap-1 min-w-0">
          <Globe className="w-3 h-3 text-slate-600 flex-none" />
          <span className="text-[10px] text-slate-500 truncate">
            {firm.geography.slice(0, 2).join(", ")}
          </span>
        </div>
        <span className="text-[10px] text-slate-600 flex-none">Est. {firm.founded_year}</span>
      </div>
    </div>
  );
}

// ─── Filter sidebar ────────────────────────────────────────────────────────────

interface Filters {
  stages: Stage[];
  sectors: string[];
  geographies: Geography[];
}

const DEFAULT_FILTERS: Filters = { stages: [], sectors: [], geographies: [] };

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-[#1a2a3f] pb-4 mb-4 last:border-0 last:pb-0 last:mb-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left mb-3 group"
      >
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider group-hover:text-slate-300 transition-colors">
          {title}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function FilterCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-xs font-semibold transition-all text-left ${
        checked
          ? "bg-amber-900/20 border border-amber-800/40 text-[#F59E0B]"
          : "text-slate-400 hover:text-slate-200 hover:bg-[#0a1830]"
      }`}
    >
      <div
        className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-none transition-colors ${
          checked ? "bg-[#F59E0B] border-[#F59E0B]" : "bg-[#0d1f35] border-[#243858]"
        }`}
      >
        {checked && (
          <svg className="w-2 h-2 text-white" viewBox="0 0 8 8" fill="none">
            <path d="M1 4L3 6L7 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {label}
    </button>
  );
}

function FilterSidebar({
  filters,
  onChange,
  onReset,
  mobileOpen,
  onMobileClose,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const hasActive =
    filters.stages.length > 0 ||
    filters.sectors.length > 0 ||
    filters.geographies.length > 0;

  const totalActive =
    filters.stages.length + filters.sectors.length + filters.geographies.length;

  const content = (
    <div className="h-full overflow-y-auto">
      {/* Sidebar header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#F59E0B]" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Screener</span>
          {hasActive && (
            <span className="text-[9px] font-bold bg-[#F59E0B] text-white px-1.5 py-0.5 rounded-full">
              {totalActive}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasActive && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-400 transition-colors"
            >
              <X className="w-3 h-3" />Clear
            </button>
          )}
          <button
            onClick={onMobileClose}
            className="lg:hidden text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Close filters"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <FilterSection title="Investment Stage">
        {ALL_STAGES.map((s) => (
          <FilterCheckbox
            key={s}
            label={s}
            checked={filters.stages.includes(s)}
            onChange={() => onChange({ ...filters, stages: toggle(filters.stages, s) })}
          />
        ))}
      </FilterSection>

      <FilterSection title="Sector">
        {ALL_SECTORS.map((s) => (
          <FilterCheckbox
            key={s}
            label={s}
            checked={filters.sectors.includes(s)}
            onChange={() => onChange({ ...filters, sectors: toggle(filters.sectors, s) })}
          />
        ))}
      </FilterSection>

      <FilterSection title="Geography">
        {ALL_GEOS.map((g) => (
          <FilterCheckbox
            key={g}
            label={g}
            checked={filters.geographies.includes(g)}
            onChange={() =>
              onChange({ ...filters, geographies: toggle(filters.geographies, g) })
            }
          />
        ))}
      </FilterSection>
    </div>
  );

  return (
    <>
      {/* Desktop sticky sidebar — styled as Startups screener panel */}
      <aside className="hidden lg:block w-52 flex-shrink-0 sticky top-6 self-start bg-[#0d1f35] border border-[#1a2a3f] rounded-[16px] px-4 py-4 max-h-[calc(100vh-5rem)] overflow-hidden">
        {content}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onMobileClose}
          />
          <aside className="relative w-64 bg-[#0b1626] border-r border-[#1a2a3f] px-5 py-5 overflow-y-auto">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

// ─── Sort / results bar ────────────────────────────────────────────────────────

type SortKey = "recent_investments" | "portfolio_count" | "aum_millions" | "founded_year";
type SortDir = "desc" | "asc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent_investments", label: "Most Active" },
  { key: "portfolio_count",    label: "Largest Portfolio" },
  { key: "aum_millions",       label: "Fund Size" },
  { key: "founded_year",       label: "Founded" },
];

function SortBar({
  sortKey,
  sortDir,
  onSort,
  count,
  onMobileFilter,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  count: number;
  onMobileFilter: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
      <div className="flex items-center gap-2">
        <button
          onClick={onMobileFilter}
          className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold bg-[#0d1f35] border border-[#1a2a3f] text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-all"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />Filters
        </button>
        <span className="text-xs font-semibold text-slate-500">
          <span className="text-white font-bold">{count}</span>{" "}
          {count === 1 ? "firm" : "firms"}
        </span>
      </div>

      {/* Segmented sort control — matches Startups density filter style */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sort</span>
        <div className="flex items-center bg-[#0d1f35] border border-[#1a2a3f] rounded-[10px] p-0.5 gap-0.5">
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => onSort(o.key)}
              className={`px-2.5 py-1.5 rounded-[7px] text-[10px] font-semibold transition-all whitespace-nowrap ${
                sortKey === o.key
                  ? "bg-[#F59E0B] text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {o.label}
              {sortKey === o.key && (
                <span className="ml-1 opacity-70">{sortDir === "desc" ? "↓" : "↑"}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function VCs() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("recent_investments");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const activeFilterCount =
    filters.stages.length + filters.sectors.length + filters.geographies.length;

  const filtered = useMemo<VCFirm[]>(() => {
    let result = [...DUMMY_VCS];

    if (filters.stages.length > 0) {
      result = result.filter((v) => filters.stages.some((s) => v.stages.includes(s)));
    }
    if (filters.sectors.length > 0) {
      result = result.filter((v) => filters.sectors.some((s) => v.sectors.includes(s)));
    }
    if (filters.geographies.length > 0) {
      result = result.filter((v) =>
        filters.geographies.some((g) => v.geography.includes(g))
      );
    }

    result.sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      return sortDir === "desc" ? bv - av : av - bv;
    });

    return result;
  }, [filters, sortKey, sortDir]);

  return (
    <Layout>

      {/* ── Dark header band — exact Startups pattern ── */}
      <div className="bg-[#0b1626] border-b border-[#1a2a3f]">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-6 pb-6">

          {/* Title row */}
          <div className="flex items-center justify-between gap-4 mb-1.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              VC Directory
            </h1>
            <div className="flex items-center gap-2 flex-none">
              <span className="text-xs font-semibold text-slate-500 bg-[#0d1f35] border border-[#1a2a3f] px-2.5 py-1 rounded-full">
                {DUMMY_VCS.length} firms indexed
              </span>
              <span className="text-xs font-semibold text-slate-500 bg-[#0d1f35] border border-[#1a2a3f] px-2.5 py-1 rounded-full hidden sm:block">
                Supabase-ready
              </span>
            </div>
          </div>

          {/* Subtitle */}
          <p className="text-sm text-slate-400 leading-snug mb-5">
            Institutional-grade intelligence on leading VC firms — sector focus, portfolio activity, and fund size.
          </p>

        </div>
      </div>

      {/* ── Main content area — Layout provides bg-[#F3F4F6] ── */}
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-6 items-start">

          {/* Screener sidebar */}
          <FilterSidebar
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_FILTERS)}
            mobileOpen={mobileFilterOpen}
            onMobileClose={() => setMobileFilterOpen(false)}
          />

          {/* Grid + sort */}
          <main className="flex-1 min-w-0">
            <SortBar
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              count={filtered.length}
              onMobileFilter={() => setMobileFilterOpen(true)}
            />

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <Building2 className="w-8 h-8 text-gray-300 mb-3" />
                <p className="text-sm font-semibold text-gray-400">No firms match these filters</p>
                <button
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="mt-3 text-xs text-[#F59E0B] font-semibold hover:underline"
                >
                  Clear all filters
                  {activeFilterCount > 0 && ` (${activeFilterCount})`}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {filtered.map((firm) => (
                  <VCCard key={firm.id} firm={firm} />
                ))}
              </div>
            )}
          </main>

        </div>
      </div>

    </Layout>
  );
}
