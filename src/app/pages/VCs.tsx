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
} from "lucide-react";
import { Layout } from "../components/Layout";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Stage = "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Growth";
type Geography = "North America" | "Europe" | "Israel" | "Asia-Pacific" | "Global" | "MENA";

interface SectorWeight {
  sector: string;
  weight: number;
}

// Supabase-ready shape — swap DUMMY_VCS for a real fetchVCs() call
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
  sector_weights: SectorWeight[]; // radar chart data
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

const RADAR_STROKE = "#60a5fa";
const RADAR_FILL   = "rgba(96,165,250,0.15)";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatAUM(millions: number | null): string {
  if (millions == null) return "Undisclosed";
  if (millions >= 1_000) return `$${(millions / 1_000).toFixed(1)}B`;
  return `$${millions}M`;
}

// ─── VCCard ────────────────────────────────────────────────────────────────────

function VCCard({ firm }: { firm: VCFirm }) {
  return (
    <article className="flex flex-col bg-gradient-to-br from-slate-800/80 to-blue-950/60 border border-blue-900/40 rounded-2xl overflow-hidden shadow-xl hover:shadow-blue-900/30 hover:border-blue-700/60 transition-all duration-300">
      {/* ── Card header ── */}
      <div className="px-5 pt-5 pb-3 border-b border-blue-900/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-blue-700/40 to-indigo-800/40 border border-blue-700/30 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-300" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-white text-base leading-tight truncate">{firm.name}</h3>
              <p className="text-xs text-blue-400/80 mt-0.5 leading-tight line-clamp-1">{firm.tagline}</p>
            </div>
          </div>
          <a
            href={firm.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-blue-300 hover:bg-blue-900/30 transition-colors"
            aria-label={`Visit ${firm.name} website`}
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* Stage pills */}
        <div className="flex flex-wrap gap-1 mt-3">
          {firm.stages.map((s) => (
            <span
              key={s}
              className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-indigo-900/60 text-indigo-300 border border-indigo-700/40"
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* ── Radar chart ── */}
      <div className="px-3 pt-3 pb-1">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 text-center mb-1">
          Sector Focus
        </p>
        <div className="h-[196px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={firm.sector_weights} outerRadius="72%">
              <PolarGrid stroke="rgba(99,130,194,0.2)" strokeDasharray="3 3" />
              <PolarAngleAxis
                dataKey="sector"
                tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 500 }}
              />
              <Radar
                dataKey="weight"
                stroke={RADAR_STROKE}
                fill={RADAR_FILL}
                strokeWidth={1.8}
                dot={{ fill: RADAR_STROKE, r: 2.5 }}
              />
              <Tooltip
                contentStyle={{
                  background: "#0f172a",
                  border: "1px solid #1e3a5f",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                itemStyle={{ color: "#93c5fd" }}
                formatter={(v: number) => [`${v}%`, "Weight"]}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Key stats row ── */}
      <div className="grid grid-cols-3 gap-px bg-blue-900/20 border-t border-blue-900/30">
        <div className="bg-slate-900/50 px-3 py-3 text-center">
          <div className="text-sm font-bold text-white">{formatAUM(firm.aum_millions)}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">AUM</div>
        </div>
        <div className="bg-slate-900/50 px-3 py-3 text-center">
          <div className="text-sm font-bold text-white">{firm.portfolio_count}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Portfolio Cos</div>
        </div>
        <div className="bg-slate-900/50 px-3 py-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span className="text-sm font-bold text-white">{firm.recent_investments}</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Deals / 12 mo</div>
        </div>
      </div>

      {/* ── Notable exits ── */}
      <div className="px-5 py-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Star className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
            Notable Exits
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {firm.notable_exits.slice(0, 4).map((e) => (
            <span
              key={e}
              className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-900/20 text-amber-400/80 border border-amber-800/30"
            >
              {e}
            </span>
          ))}
          {firm.notable_exits.length > 4 && (
            <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-800/60 text-slate-500">
              +{firm.notable_exits.length - 4}
            </span>
          )}
        </div>
      </div>

      {/* ── Card footer ── */}
      <div className="px-5 pb-4 mt-auto flex items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center gap-1">
          <Globe className="w-3 h-3" />
          <span>{firm.geography.slice(0, 2).join(", ")}</span>
        </div>
        <span>Est. {firm.founded_year}</span>
      </div>
    </article>
  );
}

// ─── Filter sidebar helpers ────────────────────────────────────────────────────

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
    <div className="border-b border-blue-900/30 pb-4 mb-4 last:border-0 last:pb-0 last:mb-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left mb-3 text-xs font-bold text-blue-200 uppercase tracking-widest hover:text-white transition-colors"
      >
        {title}
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

function CheckPill({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group select-none">
      <button
        role="checkbox"
        aria-checked={checked}
        onClick={onChange}
        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors
          ${
            checked
              ? "bg-blue-600 border-blue-500"
              : "bg-slate-800 border-slate-600 group-hover:border-blue-600"
          }`}
      >
        {checked && (
          <svg
            className="w-2.5 h-2.5 text-white"
            viewBox="0 0 10 10"
            fill="none"
          >
            <path
              d="M1.5 5L4 7.5L8.5 2.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">
        {label}
      </span>
    </label>
  );
}

// ─── FilterSidebar ─────────────────────────────────────────────────────────────

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

  const content = (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-bold text-white tracking-wide">Filters</h2>
          {hasActive && (
            <span className="w-2 h-2 rounded-full bg-blue-500" />
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasActive && (
            <button
              onClick={onReset}
              className="text-xs text-blue-400 hover:text-blue-200 transition-colors"
            >
              Reset
            </button>
          )}
          <button
            onClick={onMobileClose}
            className="lg:hidden text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none"
            aria-label="Close filters"
          >
            ×
          </button>
        </div>
      </div>

      <FilterSection title="Investment Stage">
        {ALL_STAGES.map((s) => (
          <CheckPill
            key={s}
            label={s}
            checked={filters.stages.includes(s)}
            onChange={() => onChange({ ...filters, stages: toggle(filters.stages, s) })}
          />
        ))}
      </FilterSection>

      <FilterSection title="Sector">
        {ALL_SECTORS.map((s) => (
          <CheckPill
            key={s}
            label={s}
            checked={filters.sectors.includes(s)}
            onChange={() => onChange({ ...filters, sectors: toggle(filters.sectors, s) })}
          />
        ))}
      </FilterSection>

      <FilterSection title="Geography">
        {ALL_GEOS.map((g) => (
          <CheckPill
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
      {/* Desktop sticky sidebar */}
      <aside className="hidden lg:block w-56 flex-shrink-0 sticky top-6 self-start bg-gradient-to-b from-slate-900/90 to-blue-950/40 border border-blue-900/30 rounded-2xl p-5 max-h-[calc(100vh-5rem)] overflow-hidden">
        {content}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onMobileClose}
          />
          <aside className="relative w-72 bg-slate-900 border-r border-blue-900/40 p-5 overflow-y-auto">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

// ─── SortBar ───────────────────────────────────────────────────────────────────

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
    <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileFilter}
          className="lg:hidden flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/60 text-slate-300 border border-slate-700/40 hover:border-blue-600"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
        </button>
        <span className="text-sm text-slate-400">
          <span className="font-semibold text-white">{count}</span>{" "}
          {count === 1 ? "firm" : "firms"}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-slate-500 mr-1">Sort by</span>
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => onSort(o.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${
                sortKey === o.key
                  ? "bg-blue-700/80 text-blue-100 border border-blue-600/50"
                  : "bg-slate-800/60 text-slate-400 border border-slate-700/40 hover:text-slate-200 hover:border-slate-600"
              }`}
          >
            {o.label}
            {sortKey === o.key && (
              <span className="ml-1 opacity-60">{sortDir === "desc" ? "↓" : "↑"}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page Component ───────────────────────────────────────────────────────

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
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950/20 to-slate-950">
        {/* ── Page hero ── */}
        <header className="px-6 md:px-8 pt-8 pb-6 border-b border-blue-900/30">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                <Users className="w-6 h-6 text-blue-400" />
                Venture Capital Directory
              </h1>
              <p className="mt-1.5 text-sm text-slate-400 max-w-lg">
                Institutional-grade intelligence on leading VC firms — sector focus,
                portfolio activity, and fund size at a glance.
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-blue-900/40 text-blue-300 border border-blue-800/40">
                {DUMMY_VCS.length} firms indexed
              </span>
              <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-indigo-900/40 text-indigo-300 border border-indigo-800/40">
                Supabase-ready
              </span>
            </div>
          </div>
        </header>

        {/* ── Content ── */}
        <div className="flex gap-6 px-6 md:px-8 pt-6 pb-12 items-start">
          <FilterSidebar
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_FILTERS)}
            mobileOpen={mobileFilterOpen}
            onMobileClose={() => setMobileFilterOpen(false)}
          />

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
                <Users className="w-12 h-12 text-slate-700 mb-4" />
                <p className="text-slate-500 text-sm">No firms match your current filters.</p>
                <button
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="mt-4 text-blue-400 text-sm hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
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
