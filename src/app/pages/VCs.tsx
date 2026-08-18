import React, { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  TrendingUp, Globe, Star, ExternalLink, X, DollarSign, Briefcase, Activity,
  ChevronLeft, ChevronRight, ChevronDown, Search, Zap,
  Square, CheckSquare, Eye, CheckCircle2, Loader2, GitCompare, MapPin, Calendar, AlertCircle,
  HelpCircle, Building2, ArrowUpDown,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { SideFilterLayout, FilterAccordion, FilterBadge, StepSlider } from "../components/SideFilterLayout";
import { fetchInvestors, fetchRecentActiveInvestorNames, type InvestorRow } from "../../lib/supabase";
import { VCModal } from "../components/VCModal";
import { DonutFocusChart } from "../components/DonutFocusChart";
import { CompanyLogo } from "../components/CompanyLogo";
import { useWatchlistMembership, addToWatchlist, removeFromWatchlist, watchlistErrorMessage } from "../../lib/watchlist";
import { ProductTour, type TourStep } from "../components/ProductTour";

const TOUR_SEEN_KEY = "alphamap_tour_vcs_seen";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage     = "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Growth";
type Geography = "North America" | "Europe" | "Israel" | "Asia-Pacific" | "Global" | "MENA";

interface SectorWeight { sector: string; weight: number }

export interface VCFirm {
  id:                 string;
  // Real `investors.id` UUID — distinct from `id` above (which is the slug,
  // used for routing/card keys). Needed for watchlist entity_id since
  // watchlist_items has no notion of slugs.
  investorId:         string;
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
    investorId:         row.id,
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
  "Pre-Seed": "bg-violet-50 text-violet-700 border border-violet-200",
  "Seed":     "bg-sky-50 text-sky-700 border border-sky-200",
  "Series A": "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "Series B": "bg-amber-50 text-amber-700 border border-amber-200",
  "Growth":   "bg-indigo-50 text-indigo-700 border border-indigo-200",
};

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortKey = "recent_investments" | "portfolio_count" | "aum_millions" | "founded_year";
type SortDir = "desc" | "asc";

const SORT_OPTIONS: { key: SortKey; labelKey: string }[] = [
  { key: "recent_investments", labelKey: "vcs.mostActive" },
  { key: "portfolio_count",    labelKey: "common.portfolio" },
  { key: "aum_millions",       labelKey: "metrics.aum" },
  { key: "founded_year",       labelKey: "vcs.founded" },
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
  stages:     Stage[];
  sectors:    string[];
  geo:        Geography | "";
  checkStep:  CheckStep;
  aumStep:    AumStep;
  // "Active (24 mo)" — firm appears on a deal in our deals feed within the
  // last 24 months (real deal data; investor rows carry no recency of their own)
  activeOnly: boolean;
}

const DEFAULT_FILTERS: Filters = {
  stages: [], sectors: [], geo: "",
  checkStep: "all", aumStep: "all", activeOnly: false,
};

// ─── VCCard ───────────────────────────────────────────────────────────────────

function VCCard({ firm, onClick, selected, onToggleSelect, dataTour }: {
  firm: VCFirm; onClick: () => void; selected: boolean; onToggleSelect: (e: React.MouseEvent) => void;
  dataTour?: string;
}) {
  const { t } = useTranslation();
  const accent = getAccent(firm.id);

  return (
    <div
      data-tour={dataTour}
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
        el.style.borderColor = accent.borderHover;
        el.style.boxShadow = `0 16px 40px rgba(15,23,42,0.10), 0 0 0 1px ${accent.borderHover}`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget;
        el.style.transform = "";
        el.style.borderColor = "#E5E7EB";
        el.style.boxShadow = "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)";
      }}
    >
      {/* Top shimmer accent line */}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{ background: `linear-gradient(90deg, transparent, ${accent.shimmerColor}, transparent)` }}
      />

      {/* Card header */}
      <div className="px-5 pt-5 pb-4 relative z-10">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <CompanyLogo name={firm.name} website={firm.website} size={44} rounded="rounded-xl" />
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-gray-900 truncate leading-tight tracking-tight">
                {firm.name}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-1 leading-tight">
                {firm.tagline}
              </p>
            </div>
          </div>

          <a
            href={firm.website}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex-none p-1.5 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
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
          style={{ background: "#F8F9FA", border: "1px solid #EEF0F2" }}
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

          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 text-center pt-3 pb-0.5">{t("vcs.focusAreas")}</p>

          <DonutFocusChart data={firm.sector_weights} accentColor={accent.radarStroke} height={190} />
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-1.5 px-4 py-3 relative z-10">
        <div className="rounded-[10px] px-2.5 py-2.5 bg-gray-50 border border-gray-100">
          <div className="flex items-center gap-1 mb-1">
            <DollarSign className="w-2.5 h-2.5 text-emerald-600 flex-none" />
            <span className="text-[8.5px] font-bold text-gray-400 uppercase tracking-wider">AUM</span>
          </div>
          <div className="text-sm font-bold text-emerald-600 leading-none">{formatAUM(firm.aum_millions)}</div>
        </div>

        <div className="rounded-[10px] px-2.5 py-2.5 bg-gray-50 border border-gray-100">
          <div className="flex items-center gap-1 mb-1">
            <Briefcase className="w-2.5 h-2.5 text-cyan-600 flex-none" />
            <span className="text-[8.5px] font-bold text-gray-400 uppercase tracking-wider">{t("common.portfolio")}</span>
          </div>
          <div className="text-sm font-bold text-cyan-600 leading-none">{firm.portfolio_count}</div>
        </div>

        <div className="rounded-[10px] px-2.5 py-2.5 bg-gray-50 border border-gray-100">
          <div className="flex items-center gap-1 mb-1">
            <Activity className="w-2.5 h-2.5 text-amber-600 flex-none" />
            <span className="text-[8.5px] font-bold text-gray-400 uppercase tracking-wider">{t("vcs.dealsPerYear")}</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-amber-600 flex-none" />
            <span className="text-sm font-bold text-amber-600 leading-none">{firm.recent_investments}</span>
          </div>
        </div>
      </div>

      {/* Notable exits */}
      <div className="px-5 pb-4 relative z-10">
        <div className="flex items-center gap-1.5 mb-2">
          <Star className="w-3 h-3" style={{ color: accent.radarStroke }} />
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">{t("vcs.notableExits")}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {firm.notable_exits.slice(0, 4).map(exit => (
            <span
              key={exit}
              className="px-2 py-0.5 text-[10px] font-semibold rounded-full text-gray-700 bg-gray-50 border border-gray-200"
            >
              {exit}
            </span>
          ))}
          {firm.notable_exits.length > 4 && (
            <span
              className="px-2 py-0.5 text-[10px] rounded-full text-gray-400 bg-gray-50 border border-gray-100"
            >
              +{firm.notable_exits.length - 4}
            </span>
          )}
        </div>
      </div>

      {/* Card footer */}
      <div
        className="px-5 py-3 mt-auto flex items-center justify-between gap-2 relative z-10 border-t border-gray-100"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Globe className="w-3 h-3 text-gray-400 flex-none" />
          <span className="text-[10px] text-gray-500 truncate">{firm.geography.slice(0, 2).join(", ")}</span>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <span className="text-[10px] text-gray-400 font-medium">Est. {firm.founded_year}</span>
          <button
            onClick={onToggleSelect}
            className="p-0.5 rounded text-gray-400 hover:text-[#0F172A] transition-colors"
            aria-label={selected ? "Deselect" : "Select for comparison"}
          >
            {selected
              ? <CheckSquare className="w-4 h-4 text-[#0F172A]" />
              : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="rounded-[22px] border overflow-hidden animate-pulse bg-white"
      style={{ borderColor: "#E5E7EB", height: 420 }}
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl flex-none bg-gray-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 rounded-full w-2/3 bg-gray-100" />
            <div className="h-2.5 rounded-full w-1/2 bg-gray-100" />
          </div>
        </div>
        <div className="flex gap-1">
          {[40, 52, 44].map(w => (
            <div key={w} className="h-4 rounded-full bg-gray-100" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="mx-4 rounded-[14px] h-[200px] bg-gray-50 border border-gray-100" />
      <div className="grid grid-cols-3 gap-1.5 px-4 py-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-14 rounded-[10px] bg-gray-50 border border-gray-100" />
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
  const { t } = useTranslation();
  if (pageCount <= 1) return null;
  const pages = getPageRange(page, pageCount);
  return (
    <div className="flex items-center justify-center gap-1 mt-10 mb-2">
      <button
        onClick={() => onChange(page - 1)} disabled={page === 1}
        className="flex items-center gap-1 px-3 py-2 rounded-[10px] text-xs font-semibold text-gray-500 hover:text-[#0F172A] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-transparent hover:border-gray-200"
      >
        <ChevronLeft className="w-3.5 h-3.5" />{t("common.prev")}</button>
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
      >{t("common.next")}<ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Compare modal ────────────────────────────────────────────────────────────

function VCCompareModal({ firms, onClose }: { firms: VCFirm[]; onClose: () => void }) {
  const { t } = useTranslation();
  const rows: { label: string; icon: React.ElementType; value: (f: VCFirm) => string }[] = [
    { label: t("vcs.headquarters"),  icon: MapPin,     value: (f) => f.headquarters },
    { label: t("vcs.founded"),       icon: Calendar,   value: (f) => f.founded_year ? String(f.founded_year) : "—" },
    { label: t("metrics.aum"),           icon: DollarSign, value: (f) => formatAUM(f.aum_millions) },
    { label: "Portfolio",     icon: Briefcase,  value: (f) => String(f.portfolio_count) },
    { label: "Deals / yr",    icon: Activity,   value: (f) => String(f.recent_investments) },
    { label: "Check Size",    icon: DollarSign, value: (f) => f.typical_check_size ?? "—" },
    { label: "Stages",        icon: TrendingUp, value: (f) => f.stages.join(", ") || "—" },
    { label: "Sectors",       icon: Star,       value: (f) => f.sectors.join(", ") || "—" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(6,13,25,0.55)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden bg-white rounded-[24px] shadow-[0_32px_80px_rgba(15,23,42,0.35)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-none flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-[#0F172A]">{t("common.compareFirms")}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-[#0F172A] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 pb-3 pr-4 w-32">{t("common.metric")}</th>
                  {firms.map((f) => (
                    <th key={f.id} className="text-left pb-3 px-4 min-w-[160px]">
                      <div className="flex items-center gap-2">
                        <CompanyLogo name={f.name} website={f.website} size={26} rounded="rounded-[8px]" />
                        <span className="text-sm font-bold text-[#0F172A] truncate">{f.name}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-gray-100">
                    <td className="py-3 pr-4 text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                      <row.icon className="w-3.5 h-3.5 text-gray-300" />{t(row.labelKey)}
                    </td>
                    {firms.map((f) => (
                      <td key={f.id} className="py-3 px-4 text-sm font-bold text-[#0F172A]">{row.value(f)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function VCs() {
  const { t } = useTranslation();
  const [firms, setFirms]           = useState<VCFirm[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [filters, setFilters]       = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey]       = useState<SortKey>("recent_investments");
  const [sortDir, setSortDir]       = useState<SortDir>("desc");
  const [page, setPage]             = useState(1);
  const [selectedFirm, setSelectedFirm] = useState<VCFirm | null>(null);
  const [activeNames, setActiveNames]   = useState<Set<string> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // ── Compare selection + watchlist (mirrors Startups.tsx) ──────────────────
  const navigate = useNavigate();
  const watchlist = useWatchlistMembership();
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [compareMap, setCompareMap] = useState<Map<string, VCFirm>>(new Map());
  const [showCompare, setShowCompare] = useState(false);

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
    { target: '[data-tour="search-input"]',      icon: Search,           title: t("tour.vcs.steps.search.title"),   description: t("tour.vcs.steps.search.body") },
    { target: '[data-tour="filter-stages"]',      icon: TrendingUp,       title: t("tour.vcs.steps.stages.title"),   description: t("tour.vcs.steps.stages.body") },
    { target: '[data-tour="filter-sectors"]',     icon: Building2,        title: t("tour.vcs.steps.sectors.title"),  description: t("tour.vcs.steps.sectors.body") },
    { target: '[data-tour="filter-geography"]',   icon: Globe,            title: t("tour.vcs.steps.geography.title"), description: t("tour.vcs.steps.geography.body") },
    { target: '[data-tour="filter-smart"]',       icon: Zap,              title: t("tour.vcs.steps.smart.title"),    description: t("tour.vcs.steps.smart.body") },
    { target: '[data-tour="sort-control"]',       icon: ArrowUpDown,      title: t("tour.vcs.steps.sort.title"),     description: t("tour.vcs.steps.sort.body") },
    { target: '[data-tour="vc-results"]',         icon: GitCompare,       title: t("tour.vcs.steps.results.title"),  description: t("tour.vcs.steps.results.body") },
  ];

  function toggleCompareSelect(firm: VCFirm, e: React.MouseEvent) {
    e.stopPropagation();
    setCompareMap((prev) => {
      const next = new Map(prev);
      if (next.has(firm.id)) { next.delete(firm.id); }
      else if (next.size < 3) { next.set(firm.id, firm); }
      return next;
    });
  }

  async function toggleWatchlistForSelected() {
    const [only] = Array.from(compareMap.values());
    if (!only) return;
    setWatchlistBusy(true);
    setWatchlistError(null);
    try {
      if (watchlist.has("investor", only.investorId)) await removeFromWatchlist("investor", only.investorId);
      else await addToWatchlist("investor", only.investorId);
      watchlist.refresh();
    } catch (err) {
      if (err instanceof Error && err.message.includes("signed in")) {
        navigate(`/login?next=${encodeURIComponent("/vcs")}`);
      } else {
        setWatchlistError(watchlistErrorMessage(err));
      }
    } finally {
      setWatchlistBusy(false);
    }
  }

  useEffect(() => {
    fetchInvestors()
      .then(rows  => setFirms(rows.map(rowToFirm)))
      .catch(err  => setFetchError((err as Error).message))
      .finally(() => setLoading(false));
    // Best-effort: powers the Active (24 mo) filter; failure just disables it
    fetchRecentActiveInvestorNames(24).then(setActiveNames).catch(() => setActiveNames(new Set()));
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
    filters.activeOnly ? "1" : "",
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

    if (filters.activeOnly && activeNames) {
      result = result.filter(v => activeNames.has(v.name.trim().toLowerCase()));
    }

    result.sort((a, b) => {
      const raw = (v: VCFirm) => {
        const n = v[sortKey] as number | null | undefined;
        return n == null || isNaN(n as number) ? 0 : n;
      };
      return sortDir === "desc" ? raw(b) - raw(a) : raw(a) - raw(b);
    });

    return result;
  }, [firms, search, filters, sortKey, sortDir, activeNames]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage  = Math.min(page, pageCount);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const checkLabel = CHECK_SIZE_STEPS.find(s => s.value === filters.checkStep)?.label ?? "All";
  const aumLabel   = AUM_STEPS.find(s => s.value === filters.aumStep)?.label ?? "All";

  return (
    <Layout>

      {/* ── Title bar (blue-gray — same band as Startups/PE) ─────────────── */}
      <div style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 pt-6 pb-5">
          <div className="flex items-center justify-between gap-4 mb-1.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">{t("vcs.directoryTitle")}</h1>

            {/* Sort segmented control */}
            <div className="flex items-center gap-2 flex-none">
              <button
                onClick={() => setTourOpen(true)}
                title={t("tour.takeTour")}
                aria-label={t("tour.takeTour")}
                className="p-2 rounded-[10px] bg-white/60 border border-black/10 text-[#0F172A]/60 hover:text-[#0F172A] hover:bg-white transition-all"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-bold text-[#0F172A]/50 uppercase tracking-wider hidden sm:block">{t("common.sort")}</span>
              <div data-tour="sort-control" className="flex items-center bg-white/60 border border-black/10 rounded-[10px] p-0.5 gap-0.5">
                {SORT_OPTIONS.map(o => (
                  <button
                    key={o.key}
                    onClick={() => handleSort(o.key)}
                    className={`px-2.5 py-1.5 rounded-[7px] text-[10px] font-semibold transition-all whitespace-nowrap ${
                      sortKey === o.key
                        ? "bg-[#0F172A] text-white shadow-sm"
                        : "text-[#0F172A]/60 hover:text-[#0F172A]"
                    }`}
                  >
                    {t(o.labelKey)}
                    {sortKey === o.key && (
                      <span className="ml-0.5 opacity-70">{sortDir === "desc" ? "↓" : "↑"}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <p className="text-sm text-[#0F172A]/60 leading-snug">
              {t("vcs.pageSubtitle")}
            </p>
          </div>
        </div>
      </div>

      {/* ── Sidebar + main content (shared SideFilterLayout shell) ───────── */}
      <SideFilterLayout
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("vcs.searchFirms")}
        activeFilterCount={activeFilterCount}
        onClearAll={clearAll}
        filters={
          <>
            <FilterAccordion dataTour="filter-stages" title={t("vcs.investmentStages")} defaultOpen
              badge={filters.stages.length > 0 ? <FilterBadge>{filters.stages.length} selected</FilterBadge> : undefined}>
              <div className="flex flex-wrap gap-1.5">
                {ALL_STAGES.map(st => (
                  <button
                    key={st}
                    onClick={() => setFilters(f => ({ ...f, stages: toggle(f.stages, st) }))}
                    className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition-all whitespace-nowrap ${
                      filters.stages.includes(st)
                        ? "bg-[#0F172A] text-white border-[#0F172A] shadow-sm"
                        : "bg-gray-50 border-gray-100 text-gray-500 hover:border-gray-300 hover:text-[#0F172A]"
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </FilterAccordion>

            <FilterAccordion dataTour="filter-sectors" title={t("common.sectors")} defaultOpen
              badge={filters.sectors.length > 0 ? <FilterBadge>{filters.sectors.length} selected</FilterBadge> : undefined}>
              <div className="flex flex-wrap gap-1.5">
                {ALL_SECTORS.map(sec => (
                  <button
                    key={sec}
                    onClick={() => setFilters(f => ({ ...f, sectors: toggle(f.sectors, sec) }))}
                    className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition-all whitespace-nowrap ${
                      filters.sectors.includes(sec)
                        ? "bg-[#0F172A] text-white border-[#0F172A] shadow-sm"
                        : "bg-gray-50 border-gray-100 text-gray-500 hover:border-gray-300 hover:text-[#0F172A]"
                    }`}
                  >
                    {sec}
                  </button>
                ))}
              </div>
            </FilterAccordion>

            <FilterAccordion dataTour="filter-geography" title={t("vcs.geography")} defaultOpen={false}
              badge={filters.geo ? <FilterBadge>{filters.geo}</FilterBadge> : undefined}>
              <div className="space-y-0.5">
                <button
                  onClick={() => setFilters(f => ({ ...f, geo: "" }))}
                  className={`w-full text-left px-2.5 py-1.5 rounded-[8px] text-xs font-semibold transition-colors ${!filters.geo ? "bg-[#0F172A] text-white" : "text-gray-600 hover:bg-gray-50"}`}
                >{t("vcs.allRegions")}</button>
                {GEO_OPTIONS.map(g => (
                  <button
                    key={g}
                    onClick={() => setFilters(f => ({ ...f, geo: f.geo === g ? "" : g }))}
                    className={`w-full text-left px-2.5 py-1.5 rounded-[8px] text-xs font-semibold transition-colors ${filters.geo === g ? "bg-[#0F172A] text-white" : "text-gray-600 hover:bg-gray-50"}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </FilterAccordion>

            <div data-tour="filter-smart">
            <FilterAccordion title={t("vcs.fundSizeAum")} defaultOpen
              badge={filters.aumStep !== "all" ? <FilterBadge>{aumLabel}</FilterBadge> : undefined}>
              <StepSlider
                steps={AUM_STEPS}
                value={filters.aumStep}
                onChange={v => setFilters(f => ({ ...f, aumStep: v as AumStep }))}
              />
            </FilterAccordion>

            <FilterAccordion title={t("vcs.typicalCheckSize")} defaultOpen={false}
              badge={filters.checkStep !== "all" ? <FilterBadge>{checkLabel}</FilterBadge> : undefined}>
              <StepSlider
                steps={CHECK_SIZE_STEPS}
                value={filters.checkStep}
                onChange={v => setFilters(f => ({ ...f, checkStep: v as CheckStep }))}
              />
            </FilterAccordion>

            <FilterAccordion title={t("vcs.recentActivity")} defaultOpen
              badge={filters.activeOnly ? <FilterBadge>On</FilterBadge> : undefined}>
              <button
                onClick={() => setFilters(f => ({ ...f, activeOnly: !f.activeOnly }))}
                className={`w-full flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-xs font-semibold border transition-all ${
                  filters.activeOnly
                    ? "bg-emerald-50 border-emerald-400/60 text-emerald-700"
                    : "bg-gray-50 border-gray-100 text-gray-500 hover:border-gray-300 hover:text-[#0F172A]"
                }`}
              >
                <Zap className={`w-3.5 h-3.5 flex-none ${filters.activeOnly ? "text-emerald-600" : "text-gray-400"}`} />
                {t("vcs.activeMonths")}
                {filters.activeOnly && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-none ml-auto" />}
              </button>
              <p className="mt-2 text-[10px] text-gray-400 leading-relaxed">
                {t("vcs.activeTooltip")}
              </p>
            </FilterAccordion>
            </div>
          </>
        }
      >
        <div ref={gridRef}>
          {fetchError ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-sm font-semibold text-rose-500">{t("vcs.failedToLoad")}</p>
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
              <p className="text-sm font-semibold text-gray-500">{t("vcs.noFirmsMatch")}</p>
              <button
                onClick={clearAll}
                className="mt-3 text-xs font-semibold text-gray-500 hover:text-rose-600 transition-colors"
              >{t("common.clearAllFilters")}</button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {paginated.map((firm, i) => (
                  <VCCard
                    key={firm.id} firm={firm} onClick={() => setSelectedFirm(firm)}
                    selected={compareMap.has(firm.id)}
                    onToggleSelect={(e) => toggleCompareSelect(firm, e)}
                    dataTour={i === 0 ? "vc-results" : undefined}
                  />
                ))}
              </div>
              <Pagination page={safePage} pageCount={pageCount} onChange={handlePageChange} />
            </>
          )}
        </div>
      </SideFilterLayout>

      {selectedFirm && (
        <VCModal firm={selectedFirm} onClose={() => setSelectedFirm(null)} />
      )}

      {showCompare && compareMap.size >= 2 && (
        <VCCompareModal firms={Array.from(compareMap.values())} onClose={() => setShowCompare(false)} />
      )}

      {/* ── Floating Compare FAB (mirrors Startups.tsx) ────────────────────── */}
      {compareMap.size >= 1 && (
        <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2.5">
          {watchlistError && (
            <div className="flex items-center gap-1.5 max-w-[280px] px-3.5 py-2 rounded-[12px] text-[11px] font-semibold bg-rose-950/90 border border-rose-800/60 text-rose-300 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,0,0,0.45)]">
              <AlertCircle className="w-3.5 h-3.5 flex-none" />
              {watchlistError}
            </div>
          )}
          {compareMap.size === 1 && (() => {
            const only = Array.from(compareMap.values())[0];
            const tracked = watchlist.has("investor", only.investorId);
            return (
              <button
                onClick={toggleWatchlistForSelected}
                disabled={watchlistBusy}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-[16px] text-xs font-bold transition-all duration-200 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,0,0,0.45)] disabled:opacity-60 ${
                  tracked
                    ? "bg-emerald-950/80 border border-emerald-800/60 text-emerald-300 hover:border-emerald-600"
                    : "bg-[#0b1626]/90 border border-[#1a2a3f] text-slate-300 hover:text-white hover:border-slate-500"
                }`}
              >
                {watchlistBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : tracked ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {tracked ? "In My Watchlist" : "Add to Watchlist"}
              </button>
            );
          })()}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompareMap(new Map())}
              title="Clear selection"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-[#0b1626]/90 backdrop-blur-sm border border-[#1a2a3f] text-slate-500 hover:text-white hover:border-slate-500 transition-all shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { if (compareMap.size >= 2) setShowCompare(true); }}
              className={`flex items-center gap-2.5 px-5 py-3.5 rounded-[20px] text-sm font-bold transition-all duration-200 ${
                compareMap.size >= 2
                  ? "bg-blue-600 text-white shadow-[0_8px_40px_rgba(37,99,235,0.45)] hover:bg-blue-500 hover:shadow-[0_12px_48px_rgba(37,99,235,0.5)] hover:scale-[1.02]"
                  : "bg-[#0b1626]/90 backdrop-blur-sm border border-[#1a2a3f] text-slate-400 shadow-[0_4px_24px_rgba(0,0,0,0.45)] cursor-default"
              }`}
            >
              <GitCompare className="w-4 h-4 flex-none" />
              {compareMap.size >= 2
                ? `Compare (${compareMap.size})`
                : `Select ${2 - compareMap.size} more…`}
            </button>
          </div>
        </div>
      )}

      <ProductTour steps={tourSteps} open={tourOpen} onClose={closeTour} />
    </Layout>
  );
}
