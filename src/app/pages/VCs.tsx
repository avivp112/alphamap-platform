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
  TrendingUp,
  Globe,
  Star,
  ExternalLink,
  ChevronDown,
  SlidersHorizontal,
  X,
  DollarSign,
  Briefcase,
  Activity,
} from "lucide-react";
import { Layout } from "../components/Layout";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Stage = "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Growth";
type Geography = "North America" | "Europe" | "Israel" | "Asia-Pacific" | "Global" | "MENA";

interface SectorWeight { sector: string; weight: number }

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
  recent_investments: number;
  notable_exits: string[];
  website: string;
  sector_weights: SectorWeight[];
}

// ─── Dummy Data ────────────────────────────────────────────────────────────────

const DUMMY_VCS: VCFirm[] = [
  {
    id: "sequoia",
    name: "Sequoia Capital",
    tagline: "The Venture Partner for the Long Arc",
    description: "One of the most storied venture capital firms, backing the disruptors, the doers, and the dreamers who build legendary companies.",
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
    description: "A16z is a Silicon Valley-based venture capital firm committed to innovation. They back bold entrepreneurs building the future through technology.",
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
    description: "Accel is a leading venture capital firm that invests in people and companies that will change the world. Their network spans Silicon Valley, London, and beyond.",
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
    description: "Index Ventures is a London and San Francisco-based international VC firm backing entrepreneurs who are reshaping industries with technology.",
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
const ALL_GEOS: Geography[] = ["North America", "Europe", "Israel", "Asia-Pacific", "Global", "MENA"];

// Semi-transparent dark stage pills — elegant on dark cards
const STAGE_PILL: Record<Stage, string> = {
  "Pre-Seed":  "bg-violet-500/10 text-violet-300 border border-violet-500/20",
  "Seed":      "bg-sky-500/10 text-sky-300 border border-sky-500/20",
  "Series A":  "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20",
  "Series B":  "bg-amber-500/10 text-amber-300 border border-amber-500/20",
  "Growth":    "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20",
};

// ─── Per-firm accent palette ───────────────────────────────────────────────────
// Each firm gets a deterministic accent: radar color, card glow, avatar tint.

interface AccentConfig {
  radarStroke: string;
  radarFill: string;
  gridStroke: string;
  avatarFrom: string;
  avatarTo: string;
  avatarText: string;
  glowColor: string;      // CSS rgba — card hover ambient glow
  borderHover: string;    // CSS rgba — card hover border
  shimmerColor: string;   // CSS rgba — top shimmer line
}

const ACCENT_PALETTE: AccentConfig[] = [
  {
    // Sequoia → electric cyan
    radarStroke: '#22d3ee', radarFill: 'rgba(34,211,238,0.13)', gridStroke: 'rgba(34,211,238,0.18)',
    avatarFrom: '#0e4f5e', avatarTo: '#0a3040',
    avatarText: '#67e8f9',
    glowColor: 'rgba(34,211,238,0.10)', borderHover: 'rgba(34,211,238,0.22)', shimmerColor: 'rgba(34,211,238,0.35)',
  },
  {
    // a16z → electric violet
    radarStroke: '#a78bfa', radarFill: 'rgba(167,139,250,0.13)', gridStroke: 'rgba(139,92,246,0.18)',
    avatarFrom: '#3b1f72', avatarTo: '#1e1040',
    avatarText: '#c4b5fd',
    glowColor: 'rgba(139,92,246,0.10)', borderHover: 'rgba(167,139,250,0.22)', shimmerColor: 'rgba(167,139,250,0.35)',
  },
  {
    // Accel → emerald
    radarStroke: '#34d399', radarFill: 'rgba(52,211,153,0.13)', gridStroke: 'rgba(16,185,129,0.18)',
    avatarFrom: '#064e33', avatarTo: '#042a1c',
    avatarText: '#6ee7b7',
    glowColor: 'rgba(16,185,129,0.10)', borderHover: 'rgba(52,211,153,0.22)', shimmerColor: 'rgba(52,211,153,0.35)',
  },
  {
    // Index → amber-gold
    radarStroke: '#fbbf24', radarFill: 'rgba(251,191,36,0.13)', gridStroke: 'rgba(245,158,11,0.18)',
    avatarFrom: '#5c3d0a', avatarTo: '#2d1d04',
    avatarText: '#fcd34d',
    glowColor: 'rgba(245,158,11,0.10)', borderHover: 'rgba(251,191,36,0.22)', shimmerColor: 'rgba(251,191,36,0.35)',
  },
];

function getAccent(id: string): AccentConfig {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return ACCENT_PALETTE[h % ACCENT_PALETTE.length];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatAUM(m: number | null): string {
  if (m == null) return "—";
  return m >= 1_000 ? `$${(m / 1_000).toFixed(1)}B` : `$${m}M`;
}

function firmInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ─── VCCard ────────────────────────────────────────────────────────────────────

function VCCard({ firm }: { firm: VCFirm }) {
  const accent = getAccent(firm.id);

  return (
    <div
      className="relative group flex flex-col overflow-hidden rounded-[22px] border transition-all duration-300 cursor-default select-none"
      style={{
        background: 'linear-gradient(145deg, #1a2535 0%, #0c1524 100%)',
        borderColor: 'rgba(255,255,255,0.07)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
        willChange: 'transform',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.transform = 'translateY(-4px)';
        el.style.borderColor = accent.borderHover;
        el.style.boxShadow = `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px ${accent.borderHover}, ${accent.glowColor} 0px 0px 60px 0px, inset 0 1px 0 rgba(255,255,255,0.06)`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.transform = '';
        el.style.borderColor = 'rgba(255,255,255,0.07)';
        el.style.boxShadow = '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)';
      }}
    >
      {/* Top shimmer accent line */}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{ background: `linear-gradient(90deg, transparent, ${accent.shimmerColor}, transparent)` }}
      />

      {/* Ambient glow orb (top-center, blooms on hover) */}
      <div
        className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-3xl"
        style={{ background: accent.glowColor }}
      />

      {/* ── Card header ── */}
      <div className="px-5 pt-5 pb-4 relative z-10">
        <div className="flex items-start justify-between gap-3 mb-3">
          {/* Firm avatar */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-black flex-none border"
              style={{
                background: `linear-gradient(135deg, ${accent.avatarFrom}, ${accent.avatarTo})`,
                borderColor: `${accent.shimmerColor}`,
                color: accent.avatarText,
                boxShadow: `0 0 16px ${accent.glowColor}`,
              }}
            >
              {firmInitials(firm.name)}
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-white truncate leading-tight tracking-tight">
                {firm.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1 leading-tight">
                {firm.tagline}
              </p>
            </div>
          </div>

          {/* External link */}
          <a
            href={firm.website}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex-none p-1.5 rounded-lg text-slate-600 hover:text-slate-300 transition-colors"
            aria-label={`Visit ${firm.name}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Stage pills */}
        <div className="flex flex-wrap gap-1">
          {firm.stages.map((s) => (
            <span
              key={s}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STAGE_PILL[s]}`}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* ── Radar HUD panel ── */}
      <div className="px-4 pb-1 relative z-10">
        <div
          className="relative overflow-hidden rounded-[14px]"
          style={{
            background: 'rgba(5,10,20,0.7)',
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          {/* HUD corner brackets */}
          {(["top-2 left-2 border-t border-l", "top-2 right-2 border-t border-r",
             "bottom-2 left-2 border-b border-l", "bottom-2 right-2 border-b border-r"] as const
          ).map((cls, i) => (
            <div
              key={i}
              className={`absolute w-3 h-3 pointer-events-none ${cls}`}
              style={{ borderColor: accent.shimmerColor, opacity: 0.6 }}
            />
          ))}

          {/* Label */}
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600 text-center pt-3 pb-0.5">
            Sector Allocation
          </p>

          <div className="h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={firm.sector_weights} outerRadius="70%">
                <PolarGrid
                  stroke={accent.gridStroke}
                  strokeDasharray="2 4"
                />
                <PolarAngleAxis
                  dataKey="sector"
                  tick={{ fill: "#64748b", fontSize: 10, fontWeight: 600 }}
                />
                <Radar
                  dataKey="weight"
                  stroke={accent.radarStroke}
                  fill={accent.radarFill}
                  strokeWidth={2}
                  dot={(props: { cx: number; cy: number; index: number }) => (
                    <circle
                      key={props.index}
                      cx={props.cx}
                      cy={props.cy}
                      r={3}
                      fill={accent.radarStroke}
                      stroke="rgba(0,0,0,0.4)"
                      strokeWidth={1}
                      style={{ filter: `drop-shadow(0 0 4px ${accent.radarStroke})` }}
                    />
                  )}
                />
                <Tooltip
                  contentStyle={{
                    background: '#060e1a',
                    border: `1px solid ${accent.borderHover}`,
                    borderRadius: 10,
                    fontSize: 12,
                    boxShadow: `0 8px 32px rgba(0,0,0,0.6)`,
                  }}
                  itemStyle={{ color: accent.radarStroke }}
                  labelStyle={{ color: '#94a3b8', fontWeight: 600, fontSize: 11 }}
                  formatter={(v: number) => [`${v}%`, "Allocation"]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Key stats ── */}
      <div className="grid grid-cols-3 gap-1.5 px-4 py-3 relative z-10">
        {/* AUM */}
        <div
          className="rounded-[10px] px-2.5 py-2.5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-1 mb-1">
            <DollarSign className="w-2.5 h-2.5 text-emerald-500 flex-none" />
            <span className="text-[8.5px] font-bold text-slate-600 uppercase tracking-wider">AUM</span>
          </div>
          <div className="text-sm font-bold text-emerald-400 leading-none">{formatAUM(firm.aum_millions)}</div>
        </div>

        {/* Portfolio */}
        <div
          className="rounded-[10px] px-2.5 py-2.5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-1 mb-1">
            <Briefcase className="w-2.5 h-2.5 text-cyan-500 flex-none" />
            <span className="text-[8.5px] font-bold text-slate-600 uppercase tracking-wider">Portfolio</span>
          </div>
          <div className="text-sm font-bold text-cyan-400 leading-none">{firm.portfolio_count}</div>
        </div>

        {/* Deals/yr */}
        <div
          className="rounded-[10px] px-2.5 py-2.5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
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

      {/* ── Notable exits ── */}
      <div className="px-5 pb-4 relative z-10">
        <div className="flex items-center gap-1.5 mb-2">
          <Star className="w-3 h-3" style={{ color: accent.radarStroke }} />
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">Notable Exits</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {firm.notable_exits.slice(0, 4).map((exit) => (
            <span
              key={exit}
              className="px-2 py-0.5 text-[10px] font-semibold rounded-full text-slate-300 transition-colors duration-150"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {exit}
            </span>
          ))}
          {firm.notable_exits.length > 4 && (
            <span
              className="px-2 py-0.5 text-[10px] rounded-full text-slate-600"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              +{firm.notable_exits.length - 4}
            </span>
          )}
        </div>
      </div>

      {/* ── Card footer ── */}
      <div
        className="px-5 py-3 mt-auto flex items-center justify-between gap-2 relative z-10"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
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

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div
      className="pb-3 mb-3 last:pb-0 last:mb-0"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left mb-2.5"
      >
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.15em]">{title}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-700 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

function FilterCheckbox({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[7px] text-xs font-medium transition-all duration-150 text-left"
      style={{
        color: checked ? '#22d3ee' : '#64748b',
        background: checked ? 'rgba(34,211,238,0.07)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!checked) e.currentTarget.style.color = '#94a3b8';
      }}
      onMouseLeave={(e) => {
        if (!checked) e.currentTarget.style.color = '#64748b';
      }}
    >
      <div
        className="w-3.5 h-3.5 rounded flex items-center justify-center flex-none transition-all duration-150"
        style={{
          background: checked ? '#06b6d4' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${checked ? '#22d3ee' : 'rgba(255,255,255,0.10)'}`,
          boxShadow: checked ? '0 0 8px rgba(34,211,238,0.3)' : 'none',
        }}
      >
        {checked && (
          <svg className="w-2 h-2 text-slate-900" viewBox="0 0 8 8" fill="none">
            <path d="M1 4L3 6L7 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {label}
    </button>
  );
}

function FilterSidebar({
  filters, onChange, onReset, mobileOpen, onMobileClose,
}: {
  filters: Filters; onChange: (f: Filters) => void;
  onReset: () => void; mobileOpen: boolean; onMobileClose: () => void;
}) {
  const totalActive = filters.stages.length + filters.sectors.length + filters.geographies.length;

  const content = (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-500" />
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.15em]">Screener</span>
          {totalActive > 0 && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-slate-900"
              style={{ background: '#22d3ee', boxShadow: '0 0 8px rgba(34,211,238,0.4)' }}
            >
              {totalActive}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {totalActive > 0 && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 hover:text-rose-400 transition-colors"
            >
              <X className="w-3 h-3" />Clear
            </button>
          )}
          <button onClick={onMobileClose} className="lg:hidden text-slate-600 hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <FilterSection title="Investment Stage">
        {ALL_STAGES.map((s) => (
          <FilterCheckbox key={s} label={s} checked={filters.stages.includes(s)}
            onChange={() => onChange({ ...filters, stages: toggle(filters.stages, s) })} />
        ))}
      </FilterSection>

      <FilterSection title="Sector">
        {ALL_SECTORS.map((s) => (
          <FilterCheckbox key={s} label={s} checked={filters.sectors.includes(s)}
            onChange={() => onChange({ ...filters, sectors: toggle(filters.sectors, s) })} />
        ))}
      </FilterSection>

      <FilterSection title="Geography">
        {ALL_GEOS.map((g) => (
          <FilterCheckbox key={g} label={g} checked={filters.geographies.includes(g)}
            onChange={() => onChange({ ...filters, geographies: toggle(filters.geographies, g) })} />
        ))}
      </FilterSection>
    </div>
  );

  const sidebarStyle = {
    background: 'linear-gradient(160deg, #111827 0%, #0d1525 100%)',
    border: '1px solid rgba(255,255,255,0.07)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  };

  return (
    <>
      <aside
        className="hidden lg:block w-52 flex-shrink-0 sticky top-6 self-start rounded-[18px] px-4 py-4 max-h-[calc(100vh-5rem)] overflow-hidden"
        style={sidebarStyle}
      >
        {content}
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onMobileClose} />
          <aside className="relative w-64 px-5 py-5 overflow-y-auto" style={sidebarStyle}>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

// ─── Sort bar ──────────────────────────────────────────────────────────────────

type SortKey = "recent_investments" | "portfolio_count" | "aum_millions" | "founded_year";
type SortDir = "desc" | "asc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent_investments", label: "Most Active" },
  { key: "portfolio_count",    label: "Largest Portfolio" },
  { key: "aum_millions",       label: "Fund Size" },
  { key: "founded_year",       label: "Founded" },
];

function SortBar({
  sortKey, sortDir, onSort, count, onMobileFilter,
}: {
  sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void;
  count: number; onMobileFilter: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
      <div className="flex items-center gap-2">
        <button
          onClick={onMobileFilter}
          className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#94a3b8' }}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />Filters
        </button>
        <span className="text-xs text-slate-500">
          <span className="font-bold text-white">{count}</span>{" "}
          {count === 1 ? "firm" : "firms"}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Sort</span>
        <div
          className="flex items-center rounded-[10px] p-0.5 gap-0.5"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => onSort(o.key)}
              className="px-2.5 py-1.5 rounded-[7px] text-[10px] font-semibold transition-all whitespace-nowrap"
              style={
                sortKey === o.key
                  ? { background: '#F59E0B', color: '#fff', boxShadow: '0 0 12px rgba(245,158,11,0.35)' }
                  : { color: '#64748b' }
              }
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
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const filtered = useMemo<VCFirm[]>(() => {
    let result = [...DUMMY_VCS];
    if (filters.stages.length > 0)
      result = result.filter((v) => filters.stages.some((s) => v.stages.includes(s)));
    if (filters.sectors.length > 0)
      result = result.filter((v) => filters.sectors.some((s) => v.sectors.includes(s)));
    if (filters.geographies.length > 0)
      result = result.filter((v) => filters.geographies.some((g) => v.geography.includes(g)));
    result.sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return result;
  }, [filters, sortKey, sortDir]);

  return (
    <Layout>

      {/* ── Dark header band ── */}
      <div
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0b1626 0%, #0e1e32 50%, #0b1626 100%)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Subtle dot-grid texture */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
        {/* Cyan top accent rule */}
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(34,211,238,0.4) 40%, rgba(167,139,250,0.3) 60%, transparent)' }} />

        <div className="relative mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-7 pb-6">
          <div className="flex items-center justify-between gap-4 mb-1.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              VC Directory
            </h1>
            <div className="flex items-center gap-2 flex-none">
              <span
                className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.15)', color: '#67e8f9' }}
              >
                {DUMMY_VCS.length} firms indexed
              </span>
              <span
                className="text-[10px] font-semibold px-2.5 py-1 rounded-full hidden sm:block"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b' }}
              >
                Supabase-ready
              </span>
            </div>
          </div>
          <p className="text-sm text-slate-500 leading-snug">
            Institutional-grade intelligence on leading VC firms — sector focus, portfolio activity, and fund size.
          </p>
        </div>
      </div>

      {/* ── Main content — Layout provides bg-[#F3F4F6] ── */}
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-6 items-start">

          <FilterSidebar
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_FILTERS)}
            mobileOpen={mobileFilterOpen}
            onMobileClose={() => setMobileFilterOpen(false)}
          />

          <main className="flex-1 min-w-0">
            <SortBar
              sortKey={sortKey} sortDir={sortDir} onSort={handleSort}
              count={filtered.length} onMobileFilter={() => setMobileFilterOpen(true)}
            />

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.12)' }}
                >
                  <SlidersHorizontal className="w-6 h-6 text-cyan-600" />
                </div>
                <p className="text-sm font-semibold text-slate-500">No firms match these filters</p>
                <button
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="mt-3 text-xs font-semibold text-cyan-500 hover:text-cyan-300 transition-colors"
                >
                  Clear all filters
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
