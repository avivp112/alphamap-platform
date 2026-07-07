import React, { useState, useMemo, useEffect } from "react";
import {
  DollarSign, TrendingUp, Zap, Search, X,
  ChevronUp, ChevronDown, Activity, Calendar,
  SlidersHorizontal, Layers, Building2, Info, Database,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { fetchDeals, type DealRow } from "../../lib/supabase";
import { DealModal } from "../components/DealModal";

// ── Types ─────────────────────────────────────────────────────────────────────
// Supabase-ready: swap DUMMY_DEALS for a fetchDeals() call against the `deals`
// table. The Deal interface maps 1-to-1 with the intended DB schema.

export type DealType =
  | "Pre-Seed" | "Seed"
  | "Series A" | "Series B" | "Series C" | "Series D" | "Series E+"
  | "Growth" | "Bridge" | "M&A" | "Acquisition" | "Grant"
  | "Form D" | "Form D (Equity)" | "Form D (Debt)"
  | "Other";

export interface Deal {
  id: string;
  date: string;                     // ISO 8601 date
  company_name: string;
  company_id: string | null;        // FK → startups.id (nullable until linked)
  sector: string;
  deal_type: DealType;
  deal_size: number | null;         // USD absolute (not millions)
  lead_investors: string[];
  valuation: number | null;         // Official or AlphaMap estimate
  is_valuation_estimated: boolean;  // true → show as "AlphaMap Est."
  source_url: string | null;
  country: string | null;
  notes: string | null;
}

// ── Dummy Data ─────────────────────────────────────────────────────────────────
// Replace with: const { data } = await supabase.from("deals").select("*").order("date", { ascending: false });

const DUMMY_DEALS: Deal[] = [
  {
    id: "deal-001",
    date: "2026-06-04",
    company_name: "Cognition AI",
    company_id: null,
    sector: "AI & ML",
    deal_type: "Series B",
    deal_size: 175_000_000,
    lead_investors: ["Founders Fund", "Benchmark"],
    valuation: 2_000_000_000,
    is_valuation_estimated: false,
    source_url: null, country: "USA", notes: null,
  },
  {
    id: "deal-002",
    date: "2026-06-02",
    company_name: "Wiz",
    company_id: null,
    sector: "Cybersecurity",
    deal_type: "M&A",
    deal_size: 32_000_000_000,
    lead_investors: ["Google (Alphabet)"],
    valuation: 32_000_000_000,
    is_valuation_estimated: false,
    source_url: null, country: "USA", notes: null,
  },
  {
    id: "deal-003",
    date: "2026-05-28",
    company_name: "Convergence",
    company_id: null,
    sector: "AI & ML",
    deal_type: "Series A",
    deal_size: 120_000_000,
    lead_investors: ["Balderton Capital"],
    valuation: 900_000_000,
    is_valuation_estimated: true,
    source_url: null, country: "UK", notes: null,
  },
  {
    id: "deal-004",
    date: "2026-05-21",
    company_name: "ElevenLabs",
    company_id: null,
    sector: "AI & ML",
    deal_type: "Series C",
    deal_size: 250_000_000,
    lead_investors: ["ICONIQ Growth", "a16z"],
    valuation: 3_300_000_000,
    is_valuation_estimated: false,
    source_url: null, country: "USA", notes: null,
  },
  {
    id: "deal-005",
    date: "2026-05-14",
    company_name: "Harvey AI",
    company_id: null,
    sector: "Legal Tech",
    deal_type: "Series D",
    deal_size: 300_000_000,
    lead_investors: ["Sequoia Capital", "Kleiner Perkins"],
    valuation: 2_800_000_000,
    is_valuation_estimated: true,
    source_url: null, country: "USA", notes: null,
  },
  {
    id: "deal-006",
    date: "2026-05-08",
    company_name: "Baseten",
    company_id: null,
    sector: "AI Infrastructure",
    deal_type: "Series C",
    deal_size: 75_000_000,
    lead_investors: ["IVP", "Spark Capital"],
    valuation: 550_000_000,
    is_valuation_estimated: true,
    source_url: null, country: "USA", notes: null,
  },
];

// ── Style configs ─────────────────────────────────────────────────────────────

const DEAL_TYPE_CONFIG: Record<string, { bg: string; text: string; border: string; shadow: string }> = {
  "Pre-Seed":   { bg: 'rgba(124,58,237,0.08)', text: '#6d28d9', border: 'rgba(139,92,246,0.30)',  shadow: 'none' },
  "Seed":       { bg: 'rgba(37,99,235,0.08)',  text: '#1d4ed8', border: 'rgba(59,130,246,0.30)',   shadow: 'none' },
  "Series A":   { bg: 'rgba(5,150,105,0.08)',  text: '#047857', border: 'rgba(16,185,129,0.30)',   shadow: 'none' },
  "Series B":   { bg: 'rgba(217,119,6,0.08)',  text: '#b45309', border: 'rgba(245,158,11,0.30)',   shadow: 'none' },
  "Series C":   { bg: 'rgba(234,88,12,0.08)',  text: '#c2410c', border: 'rgba(249,115,22,0.30)',   shadow: 'none' },
  "Series D":   { bg: 'rgba(220,38,38,0.08)',  text: '#b91c1c', border: 'rgba(239,68,68,0.30)',    shadow: 'none' },
  "Series E+":  { bg: 'rgba(190,18,60,0.08)',  text: '#9f1239', border: 'rgba(244,63,94,0.30)',    shadow: 'none' },
  "Growth":     { bg: 'rgba(67,56,202,0.08)',  text: '#4338ca', border: 'rgba(99,102,241,0.30)',   shadow: 'none' },
  "M&A":        { bg: 'rgba(6,182,212,0.08)',  text: '#0e7490', border: 'rgba(34,211,238,0.30)',   shadow: 'none' },
  "Acquisition":{ bg: 'rgba(6,182,212,0.08)',  text: '#0e7490', border: 'rgba(34,211,238,0.30)',   shadow: 'none' },
  "Bridge":     { bg: 'rgba(2,132,199,0.08)',  text: '#0369a1', border: 'rgba(14,165,233,0.30)',   shadow: 'none' },
  "Grant":           { bg: 'rgba(101,163,13,0.08)', text: '#4d7c0f', border: 'rgba(132,204,22,0.30)',   shadow: 'none' },
  "Other":           { bg: 'rgba(71,85,105,0.08)',  text: '#475569', border: 'rgba(100,116,139,0.30)',  shadow: 'none' },
  // SEC Form D — amber marks exclusive regulatory / unannounced deal data
  "Form D":          { bg: 'rgba(245,158,11,0.10)', text: '#92400e', border: 'rgba(245,158,11,0.38)', shadow: 'none' },
  "Form D (Equity)": { bg: 'rgba(245,158,11,0.10)', text: '#92400e', border: 'rgba(245,158,11,0.38)', shadow: 'none' },
  "Form D (Debt)":   { bg: 'rgba(251,146,60,0.10)', text: '#9a3412', border: 'rgba(251,146,60,0.38)', shadow: 'none' },
};

const SECTOR_CONFIG: Record<string, { bg: string; text: string; border: string }> = {
  "AI & ML":           { bg: 'rgba(34,211,238,0.08)',  text: '#0e7490', border: 'rgba(34,211,238,0.20)'  },
  "Cybersecurity":     { bg: 'rgba(167,139,250,0.08)', text: '#6d28d9', border: 'rgba(167,139,250,0.20)' },
  "Fintech":           { bg: 'rgba(96,165,250,0.08)',  text: '#1d4ed8', border: 'rgba(96,165,250,0.20)'  },
  "SaaS":              { bg: 'rgba(52,211,153,0.08)',  text: '#047857', border: 'rgba(52,211,153,0.20)'  },
  "HealthTech":        { bg: 'rgba(251,113,133,0.08)', text: '#be123c', border: 'rgba(251,113,133,0.20)' },
  "AI Infrastructure": { bg: 'rgba(251,191,36,0.08)',  text: '#b45309', border: 'rgba(251,191,36,0.20)'  },
  "Legal Tech":        { bg: 'rgba(192,132,252,0.08)', text: '#7e22ce', border: 'rgba(192,132,252,0.20)' },
  "DeepTech":          { bg: 'rgba(249,115,22,0.08)',  text: '#c2410c', border: 'rgba(249,115,22,0.20)'  },
  "default":           { bg: 'rgba(100,116,139,0.08)', text: '#475569', border: 'rgba(100,116,139,0.20)' },
};

const AVATAR_BG = ['#1e3a5f','#1e2d54','#2d1b47','#1a3d2b','#3d1a1a','#1a3d3d','#3d2d1a','#2d1a3d'];
const AVATAR_FG = ['#93c5fd','#a5b4fc','#d8b4fe','#6ee7b7','#fca5a5','#67e8f9','#fcd34d','#c4b5fd'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "1d ago";
  return `${diff}d ago`;
}

function companyAvatar(name: string): { bg: string; fg: string; initials: string } {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const i = h % AVATAR_BG.length;
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return { bg: AVATAR_BG[i], fg: AVATAR_FG[i], initials };
}

function getSector(s: string) { return SECTOR_CONFIG[s] ?? SECTOR_CONFIG.default; }
// Form D variants share the amber style; all other types fall back to "Other"
function getDealType(t: string) {
  if (t.startsWith("Form D")) return DEAL_TYPE_CONFIG["Form D (Equity)"];
  return DEAL_TYPE_CONFIG[t] ?? DEAL_TYPE_CONFIG.Other;
}

// ── DB → UI mapper ────────────────────────────────────────────────────────────
function rowToDeal(row: DealRow): Deal {
  return {
    id:                   row.id,
    date:                 row.deal_date,
    company_name:         row.company_name,
    company_id:           row.startup_id,
    sector:               row.sector ?? "Other",
    deal_type:            row.deal_type as DealType,
    deal_size:            row.amount_raised,
    lead_investors:       row.investors ?? [],
    valuation:            row.valuation,
    is_valuation_estimated: row.is_valuation_estimated ?? false,
    source_url:           row.source_url,
    country:              row.country,
    notes:                null,
  };
}

// ── Micro-components ──────────────────────────────────────────────────────────

function DealTypePill({ type }: { type: string }) {
  const cfg = getDealType(type);
  return (
    <span
      className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{
        background: cfg.bg,
        color: cfg.text,
        border: `1px solid ${cfg.border}`,
        boxShadow: cfg.shadow,
      }}
    >
      {type}
    </span>
  );
}

function SectorPill({ sector }: { sector: string }) {
  const cfg = getSector(sector);
  return (
    <span
      className="inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}
    >
      {sector}
    </span>
  );
}

function ValuationCell({ value, isEstimated }: { value: number | null; isEstimated: boolean }) {
  if (!value) return <span className="text-xs text-gray-400">—</span>;
  if (!isEstimated) {
    return <span className="text-xs font-bold text-gray-900">{fmtAmount(value)}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Zap className="w-2.5 h-2.5 text-amber-500 flex-none" />
      <span className="text-xs font-semibold italic text-amber-700">~{fmtAmount(value)}</span>
      <span className="text-[8px] font-bold text-amber-600/70 leading-none">(Est.)</span>
    </span>
  );
}

// ── HUD Metric card ───────────────────────────────────────────────────────────

interface HudCardProps {
  accent: string;
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}

function HudCard({ accent, icon: Icon, label, value, sub }: HudCardProps) {
  return (
    <div
      className="relative rounded-[18px] px-5 py-4 overflow-hidden bg-white"
      style={{
        border: '1px solid #E5E7EB',
        boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
      }}
    >
      {/* Top shimmer accent */}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="w-3.5 h-3.5 flex-none" style={{ color: accent }} />
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.13em]">{label}</span>
      </div>
      <div className="text-2xl font-black text-gray-900 leading-none tracking-tight">{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-1.5 leading-snug">{sub}</div>}
    </div>
  );
}

// ── Sort column header ─────────────────────────────────────────────────────────

type SortCol = "date" | "deal_size" | "valuation";
type SortDir = "asc" | "desc";

function ColHeader({
  col, label, sortCol, sortDir, onSort, className = "",
}: {
  col: SortCol | null; label: string; sortCol: SortCol; sortDir: SortDir;
  onSort: (c: SortCol) => void; className?: string;
}) {
  const active = col !== null && sortCol === col;
  if (!col) {
    return (
      <span className={`text-[9px] font-bold text-gray-400 uppercase tracking-[0.13em] ${className}`}>
        {label}
      </span>
    );
  }
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.13em] transition-colors ${
        active ? "text-gray-700" : "text-gray-400 hover:text-gray-600"
      } ${className}`}
    >
      {label}
      <span className="opacity-60 flex flex-col -space-y-1">
        <ChevronUp   className={`w-2.5 h-2.5 ${active && sortDir === "asc"  ? "opacity-100" : "opacity-30"}`} />
        <ChevronDown className={`w-2.5 h-2.5 ${active && sortDir === "desc" ? "opacity-100" : "opacity-30"}`} />
      </span>
    </button>
  );
}

// ── All deal types for filter chips ──────────────────────────────────────────

const FILTER_TYPES: Array<DealType | "All"> = [
  "All", "Seed", "Series A", "Series B", "Series C", "Series D", "Growth", "M&A", "Form D",
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export function Deals() {
  const [search,          setSearch]          = useState("");
  const [dealTypeFilter,  setDealTypeFilter]  = useState<DealType | null>(null);
  const [sortCol,         setSortCol]         = useState<SortCol>("date");
  const [sortDir,         setSortDir]         = useState<SortDir>("desc");
  const [selectedDeal,    setSelectedDeal]    = useState<Deal | null>(null);

  // ── Real data from Supabase ────────────────────────────────────────────────
  const [dbRows,   setDbRows]   = useState<DealRow[] | null>(null); // null = loading
  const [dbError,  setDbError]  = useState<string | null>(null);

  useEffect(() => {
    fetchDeals()
      .then(rows => setDbRows(rows))
      .catch(err  => { setDbError(String(err?.message ?? err)); setDbRows([]); });
  }, []);

  // Real data when available, mock fallback when table is empty or unreachable
  const allDeals: Deal[] = useMemo(() => {
    if (dbRows === null)        return DUMMY_DEALS; // still loading — show mock
    if (dbRows.length === 0)   return DUMMY_DEALS; // empty table — show mock
    return dbRows.map(rowToDeal);
  }, [dbRows]);

  const isLive    = dbRows !== null && dbRows.length > 0;
  const isLoading = dbRows === null;

  // ── HUD metrics (always from full dataset) ─────────────────────────────────
  const metrics = useMemo(() => {
    const total    = allDeals.reduce((s, d) => s + (d.deal_size ?? 0), 0);
    const largest  = allDeals.reduce<Deal | null>(
      (mx, d) => (!mx || (d.deal_size ?? 0) > (mx.deal_size ?? 0)) ? d : mx, null
    );
    const sectorCount: Record<string, number> = {};
    for (const d of allDeals) sectorCount[d.sector] = (sectorCount[d.sector] ?? 0) + 1;
    const [topSector, topSectorN] = Object.entries(sectorCount).sort((a, b) => b[1] - a[1])[0];
    const now   = new Date();
    const mtd   = allDeals.filter(d => {
      const dd = new Date(d.date);
      return dd.getFullYear() === now.getFullYear() && dd.getMonth() === now.getMonth();
    });
    const mtdCapital = mtd.reduce((s, d) => s + (d.deal_size ?? 0), 0);
    return { total, largest, topSector, topSectorN, mtdCapital, mtdCount: mtd.length };
  }, []);

  // ── Filtered + sorted deals ────────────────────────────────────────────────
  const filtered = useMemo<Deal[]>(() => {
    let out = [...allDeals];
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(d => d.company_name.toLowerCase().includes(q) || d.sector.toLowerCase().includes(q));
    }
    if (dealTypeFilter) out = out.filter(d => d.deal_type === dealTypeFilter);
    out.sort((a, b) => {
      const av = sortCol === "date" ? new Date(a.date).getTime() : sortCol === "deal_size" ? (a.deal_size ?? 0) : (a.valuation ?? 0);
      const bv = sortCol === "date" ? new Date(b.date).getTime() : sortCol === "deal_size" ? (b.deal_size ?? 0) : (b.valuation ?? 0);
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return out;
  }, [search, dealTypeFilter, sortCol, sortDir]);

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const activeFilters = (search ? 1 : 0) + (dealTypeFilter ? 1 : 0);

  return (
    <Layout>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-7 pb-6">
          <div className="flex items-center justify-between gap-4 mb-1.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
              Deal Flow
            </h1>
            <div className="flex items-center gap-2 flex-none">
              <span
                className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-800"
              >
                {allDeals.length} deals tracked
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-[#0F172A]/55">
                <span className={`w-1.5 h-1.5 rounded-full ${isLive ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                {isLoading ? "Loading…" : isLive ? "Live" : "Demo"}
              </span>
            </div>
          </div>
          <p className="text-sm text-[#0F172A]/60 font-medium">
            Transactional ledger of tracked private market deals — rounds, M&amp;A, and strategic investments.
          </p>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="bg-[#F8F9FA] min-h-screen">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5">

          {/* ── Data source banner ── */}
          {!isLoading && !isLive && (
            <div
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-[12px]"
              style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.14)' }}
            >
              <Database className="w-3.5 h-3.5 text-amber-500 flex-none" />
              <p className="text-[11px] text-amber-400/80">
                <span className="font-bold text-amber-400">Demo data</span> — run{" "}
                <code className="text-amber-300 bg-amber-500/10 px-1 rounded text-[10px]">DRY_RUN=false npx tsx scripts/fetch_sec_deals.ts</code>{" "}
                to populate the <code className="text-amber-300 bg-amber-500/10 px-1 rounded text-[10px]">deals</code> table with live SEC Form D filings.
                {dbError && <span className="ml-2 text-rose-400">({dbError})</span>}
              </p>
            </div>
          )}
          {isLive && (
            <div
              className="flex items-center gap-2 px-4 py-2 rounded-[10px]"
              style={{ background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.12)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-none" />
              <p className="text-[11px] text-emerald-400/80">
                Live data — {allDeals.filter(d => d.deal_type.startsWith("Form D")).length} SEC Form D filing{allDeals.filter(d => d.deal_type.startsWith("Form D")).length !== 1 ? "s" : ""} · {allDeals.length} total deals from Supabase
              </p>
            </div>
          )}

          {/* ── HUD Metrics ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <HudCard
              accent="#22d3ee"
              icon={DollarSign}
              label="Total Capital Tracked"
              value={fmtAmount(metrics.total)}
              sub={`${allDeals.length} deals · all time`}
            />
            <HudCard
              accent="#F59E0B"
              icon={TrendingUp}
              label="Largest Deal"
              value={fmtAmount(metrics.largest?.deal_size ?? null)}
              sub={metrics.largest ? `${metrics.largest.company_name} · ${metrics.largest.deal_type}` : undefined}
            />
            <HudCard
              accent="#a78bfa"
              icon={Layers}
              label="Most Active Sector"
              value={metrics.topSector}
              sub={`${metrics.topSectorN} deal${metrics.topSectorN !== 1 ? "s" : ""} tracked`}
            />
            <HudCard
              accent="#34d399"
              icon={Calendar}
              label="New This Month"
              value={String(metrics.mtdCount)}
              sub={metrics.mtdCount > 0 ? `${fmtAmount(metrics.mtdCapital)} deployed MTD` : "No new deals yet"}
            />
          </div>

          {/* ── Table card ── */}
          <div
            className="relative rounded-[22px] overflow-hidden bg-white"
            style={{
              border: '1px solid #E5E7EB',
              boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.05)',
            }}
          >
            {/* Top shimmer */}
            <div
              className="absolute inset-x-0 top-0 h-px pointer-events-none"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.3), transparent)' }}
            />

            {/* Card toolbar ── */}
            <div
              className="px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-gray-100"
            >
              {/* Title + count */}
              <div className="flex items-center gap-3">
                <Activity className="w-4 h-4 text-amber-500 flex-none" />
                <span className="text-xs font-bold text-gray-900 uppercase tracking-widest">Ledger</span>
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500"
                >
                  {filtered.length} / {allDeals.length}
                </span>
                {activeFilters > 0 && (
                  <button
                    onClick={() => { setSearch(""); setDealTypeFilter(null); }}
                    className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-rose-600 transition-colors"
                  >
                    <X className="w-3 h-3" />Clear
                  </button>
                )}
              </div>

              {/* Search + type filter ── */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search company…"
                    className="w-full sm:w-44 pl-8 pr-8 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 rounded-[10px] bg-gray-50 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Deal type chips */}
                <div
                  className="flex items-center gap-0.5 rounded-[10px] p-0.5 bg-gray-50 border border-gray-200"
                >
                  {FILTER_TYPES.map(t => {
                    const isActive = t === "All" ? !dealTypeFilter : dealTypeFilter === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setDealTypeFilter(t === "All" ? null : t as DealType)}
                        className="px-2.5 py-1 rounded-[7px] text-[10px] font-semibold transition-all whitespace-nowrap"
                        style={
                          isActive
                            ? { background: '#0F172A', color: '#fff' }
                            : { color: '#9CA3AF' }
                        }
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Table ── */}
            <div className="overflow-x-auto">
              <div style={{ minWidth: '900px' }}>

                {/* Column headers */}
                <div
                  className="grid px-5 py-3 gap-4 bg-gray-50 border-b border-gray-100"
                  style={{
                    gridTemplateColumns: '88px 1fr 124px 108px 1fr 160px',
                  }}
                >
                  <ColHeader col="date"      label="Date"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHeader col={null}       label="Company"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHeader col={null}       label="Type"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHeader col="deal_size" label="Size"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHeader col={null}       label="Lead Investors" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHeader col="valuation" label="Valuation" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                </div>

                {/* Data rows */}
                {filtered.length > 0 ? filtered.map((deal, idx) => {
                  const av   = companyAvatar(deal.company_name);
                  const isLast = idx === filtered.length - 1;
                  return (
                    <div
                      key={deal.id}
                      className="grid px-5 py-3.5 gap-4 cursor-pointer transition-colors duration-100"
                      style={{
                        gridTemplateColumns: '88px 1fr 124px 108px 1fr 160px',
                        borderBottom: isLast ? 'none' : '1px solid #F3F4F6',
                      }}
                      onClick={() => setSelectedDeal(deal)}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(15,23,42,0.025)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Date */}
                      <div className="flex flex-col justify-center gap-0.5">
                        <span className="text-xs font-bold text-gray-700 leading-tight tabular-nums">
                          {fmtDate(deal.date)}
                        </span>
                        <span className="text-[9px] text-gray-400 leading-tight">{daysAgo(deal.date)}</span>
                      </div>

                      {/* Company */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black flex-none"
                          style={{ background: av.bg, color: av.fg }}
                        >
                          {av.initials}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-gray-900 leading-tight truncate">{deal.company_name}</div>
                          <div className="mt-0.5">
                            <SectorPill sector={deal.sector} />
                          </div>
                        </div>
                        {deal.country && (
                          <span className="text-[9px] text-gray-400 ml-auto flex-none">{deal.country}</span>
                        )}
                      </div>

                      {/* Deal Type */}
                      <div className="flex items-center">
                        <DealTypePill type={deal.deal_type} />
                      </div>

                      {/* Deal Size */}
                      <div className="flex items-center">
                        <span className="text-xs font-black text-gray-900 tabular-nums">
                          {fmtAmount(deal.deal_size)}
                        </span>
                      </div>

                      {/* Lead Investors */}
                      <div className="flex items-center min-w-0">
                        <span className="text-xs text-gray-500 leading-snug truncate" title={deal.lead_investors.join(", ")}>
                          {deal.lead_investors.join(", ")}
                        </span>
                      </div>

                      {/* Valuation */}
                      <div className="flex items-center gap-1.5">
                        <ValuationCell value={deal.valuation} isEstimated={deal.is_valuation_estimated} />
                        {deal.is_valuation_estimated && (
                          <Info
                            className="w-3 h-3 text-amber-600/50 flex-none cursor-help"
                            title="Valuation estimated by AlphaMap proprietary model"
                          />
                        )}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="py-16 flex flex-col items-center gap-3 text-center">
                    <Building2 className="w-8 h-8 text-gray-300" />
                    <p className="text-sm text-gray-400 font-medium">No deals match your filters</p>
                    <button
                      onClick={() => { setSearch(""); setDealTypeFilter(null); }}
                      className="text-xs text-cyan-600 hover:text-cyan-700 transition-colors"
                    >
                      Clear all filters
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Footer ── */}
            <div
              className="px-5 py-3 flex items-center justify-between border-t border-gray-100"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400">
                  Showing <span className="text-gray-600 font-semibold">{filtered.length}</span> of{" "}
                  <span className="text-gray-600 font-semibold">{allDeals.length}</span> deals
                </span>
                <span className="text-[9px] text-gray-300">· Click any row to open Deal Intelligence</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-700"
                >
                  AlphaMap Est.
                </span>
                <span className="text-[9px] text-gray-300 font-medium">= proprietary model valuation</span>
              </div>
            </div>
          </div>

          {/* AlphaMap Est. legend note */}
          <div
            className="flex items-start gap-2.5 rounded-[12px] px-4 py-3"
            style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.10)' }}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-none" />
            <p className="text-[11px] text-gray-500 leading-relaxed">
              <span className="text-amber-700 font-bold">AlphaMap Estimated Valuation</span> — When a deal&apos;s
              official valuation is undisclosed, AlphaMap uses a proprietary model (sector multiples ×
              capital efficiency × talent velocity) to produce a best-estimate mark. These are highlighted
              in <span className="italic text-amber-700">amber italic</span> with a ⚡ indicator.
            </p>
          </div>

        </div>
      </div>

      {/* ── Deal Intelligence Modal ── */}
      {selectedDeal && (
        <DealModal
          deal={selectedDeal}
          allDeals={allDeals}
          onClose={() => setSelectedDeal(null)}
        />
      )}
    </Layout>
  );
}
