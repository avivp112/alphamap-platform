import React, { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { Layout } from "../components/Layout";
import { LinkedInBadge } from "../components/LinkedInBadge";
import { SideFilterLayout, FilterAccordion, FilterBadge, StepSlider } from "../components/SideFilterLayout";
import { CompanyLogo } from "../components/CompanyLogo";
import { useUserPlan, isPaidPlan } from "../../lib/plan";
import {
  Plus, Globe, Loader2, Search, X, MapPin, Calendar, Users,
  DollarSign, Rocket, AlertCircle, CheckCircle2,
  TrendingUp, TrendingDown, Minus,
  UserRound, LayoutGrid, List, ExternalLink,
  ChevronDown, ChevronLeft, ChevronRight, Building2, CheckSquare, Square,
  GitCompare, Clock, Briefcase, Zap, Info, Activity, BarChart2, ChevronUp,
  SlidersHorizontal, Award, Lock, Sparkles,
} from "lucide-react";
import {
  ingestStartup, fetchAlphaScore, fetchHeadcountHistory, fetchInvestorTierMap,
  fetchStartupsPage, fetchStartupsCount, fetchDistinctCountries, fetchStartupDetail,
  fetchSuggestedPeers, fetchStartupListRowById, STARTUPS_PAGE_SIZE,
  type Startup, type FundingRound, type RoundType, type AlphaScore, type HeadcountPoint,
  type StartupListRow, type StartupSearchFilters, type Competitor,
} from "../../lib/supabase";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(usd: number | null | undefined): string {
  if (!usd) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd}`;
}
function fmtM(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}B`;
  if (usd >= 1)    return `$${usd.toFixed(0)}M`;
  return `$${(usd * 1000).toFixed(0)}K`;
}
function fmtEmp(n: number | null): string {
  if (!n) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
function avatarColor(name: string): string {
  const colors = [
    "bg-violet-100 text-violet-700", "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700",
    "bg-teal-100 text-teal-700", "bg-orange-100 text-orange-700",
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[h % colors.length];
}

const ROUND_STYLE: Record<string, string> = {
  "Pre-Seed":         "bg-purple-50 text-purple-700 border border-purple-100",
  "Seed":             "bg-blue-50 text-blue-700 border border-blue-100",
  "Series A":         "bg-emerald-50 text-emerald-700 border border-emerald-100",
  "Series B":         "bg-amber-50 text-amber-700 border border-amber-100",
  "Series C":         "bg-orange-50 text-orange-700 border border-orange-100",
  "Series D":         "bg-orange-100 text-orange-800 border border-orange-200",
  "Series E+":        "bg-red-50 text-red-700 border border-red-100",
  "Growth":           "bg-indigo-50 text-indigo-700 border border-indigo-100",
  "Bridge":           "bg-sky-50 text-sky-700 border border-sky-100",
  "Convertible Note": "bg-cyan-50 text-cyan-700 border border-cyan-100",
  "Bootstrapped":     "bg-teal-50 text-teal-700 border border-teal-100",
  "Grant":            "bg-lime-50 text-lime-700 border border-lime-100",
  "Acquired":         "bg-gray-100 text-gray-600 border border-gray-200",
  "PE Buyout":        "bg-slate-100 text-slate-700 border border-slate-200",
  "Secondary":        "bg-stone-50 text-stone-600 border border-stone-200",
  "Debt":             "bg-zinc-50 text-zinc-600 border border-zinc-200",
  "Other":            "bg-gray-50 text-gray-500 border border-gray-100",
};
const ROUND_HEX: Record<string, string> = {
  "Pre-Seed": "#7C3AED", "Seed": "#2563EB", "Series A": "#059669",
  "Series B": "#D97706", "Series C": "#EA580C", "Series D": "#C2410C",
  "Series E+": "#DC2626", "Growth": "#4338CA", "Bridge": "#0284C7",
  "Convertible Note": "#0891B2", "Bootstrapped": "#0D9488",
  "Grant": "#65A30D", "Acquired": "#6B7280",
  "PE Buyout": "#475569", "Secondary": "#78716C", "Debt": "#71717A",
  "Other": "#9CA3AF",
};

// Per-round hover glow: border highlight + ambient shadow bloom + top shimmer
const ROUND_GLOW: Record<string, { border: string; glow: string; shimmer: string }> = {
  "Pre-Seed":         { border: 'rgba(124,58,237,0.22)',  glow: 'rgba(124,58,237,0.09)',  shimmer: 'rgba(139,92,246,0.38)' },
  "Seed":             { border: 'rgba(37,99,235,0.22)',   glow: 'rgba(59,130,246,0.09)',  shimmer: 'rgba(59,130,246,0.38)' },
  "Series A":         { border: 'rgba(5,150,105,0.22)',   glow: 'rgba(16,185,129,0.09)',  shimmer: 'rgba(16,185,129,0.38)' },
  "Series B":         { border: 'rgba(217,119,6,0.22)',   glow: 'rgba(245,158,11,0.09)',  shimmer: 'rgba(245,158,11,0.38)' },
  "Series C":         { border: 'rgba(234,88,12,0.22)',   glow: 'rgba(249,115,22,0.09)',  shimmer: 'rgba(249,115,22,0.38)' },
  "Series D":         { border: 'rgba(194,65,12,0.22)',   glow: 'rgba(234,88,12,0.09)',   shimmer: 'rgba(234,88,12,0.38)' },
  "Series E+":        { border: 'rgba(220,38,38,0.22)',   glow: 'rgba(239,68,68,0.09)',   shimmer: 'rgba(239,68,68,0.38)' },
  "Growth":           { border: 'rgba(67,56,202,0.22)',   glow: 'rgba(99,102,241,0.09)',  shimmer: 'rgba(99,102,241,0.38)' },
  "Bridge":           { border: 'rgba(2,132,199,0.22)',   glow: 'rgba(14,165,233,0.09)',  shimmer: 'rgba(14,165,233,0.38)' },
  "Convertible Note": { border: 'rgba(8,145,178,0.22)',   glow: 'rgba(6,182,212,0.09)',   shimmer: 'rgba(6,182,212,0.38)' },
  "Bootstrapped":     { border: 'rgba(13,148,136,0.22)',  glow: 'rgba(20,184,166,0.09)',  shimmer: 'rgba(20,184,166,0.38)' },
  "Grant":            { border: 'rgba(101,163,13,0.22)',  glow: 'rgba(132,204,22,0.09)',  shimmer: 'rgba(132,204,22,0.38)' },
  "default":          { border: 'rgba(34,211,238,0.22)',  glow: 'rgba(34,211,238,0.09)',  shimmer: 'rgba(34,211,238,0.38)' },
};

// ── Sector Taxonomy ───────────────────────────────────────────────────────────
// Two-tier hierarchy: parent → subcategories.
// classifyIndustry() maps any free-text industry string into this tree.

const SECTOR_TAXONOMY: Record<string, string[]> = {
  "AI & ML":               ["AI / General", "LLMs", "Generative AI", "Computer Vision", "NLP / Speech", "AI Agents", "MLOps", "AI Infrastructure"],
  "Fintech":               ["Fintech / General", "Payments", "Banking / Neobanking", "Insurance / Insurtech", "Lending", "Crypto / Web3", "WealthTech", "RegTech"],
  "Cybersecurity":         ["Cybersecurity / General", "Identity & Access", "Endpoint Security", "Cloud Security", "Threat Intelligence", "Zero Trust", "Data Security"],
  "SaaS & Dev Tools":      ["SaaS / General", "Developer Tools", "DevOps / CI-CD", "API Platforms", "Low-Code / No-Code", "Data Infrastructure"],
  "E-commerce & Retail":   ["E-commerce / General", "D2C", "Marketplaces", "Logistics / Supply Chain", "Retail Tech"],
  "Health & Life Sciences": ["Digital Health", "MedTech", "Biotech / Genomics", "Mental Health", "Healthcare SaaS"],
  "Climate & Energy":      ["CleanTech", "EnergyTech", "Carbon Markets", "Sustainability"],
  "Enterprise Software":   ["Enterprise / General", "CRM", "HR Tech", "ERP / Finance", "Analytics / BI"],
  "Consumer & Media":      ["Consumer / General", "Social Media", "Gaming", "EdTech", "Travel & Hospitality", "Media / Content"],
  "DeepTech":              ["DeepTech / General", "Quantum Computing", "Robotics", "Space Tech", "Semiconductors"],
  "Uncategorized":         [],
};

// Longest/most-specific keywords must come first to avoid partial false matches.
const INDUSTRY_KEYWORD_MAP: Array<[string, { parent: string; sub: string }]> = [
  // AI & ML
  ["generative ai",        { parent: "AI & ML", sub: "Generative AI" }],
  ["large language model", { parent: "AI & ML", sub: "LLMs" }],
  ["computer vision",      { parent: "AI & ML", sub: "Computer Vision" }],
  ["natural language",     { parent: "AI & ML", sub: "NLP / Speech" }],
  ["speech recognition",   { parent: "AI & ML", sub: "NLP / Speech" }],
  ["ai agent",             { parent: "AI & ML", sub: "AI Agents" }],
  ["agentic",              { parent: "AI & ML", sub: "AI Agents" }],
  ["mlops",                { parent: "AI & ML", sub: "MLOps" }],
  ["ai infrastructure",    { parent: "AI & ML", sub: "AI Infrastructure" }],
  ["machine learning",     { parent: "AI & ML", sub: "AI / General" }],
  ["artificial intelligence", { parent: "AI & ML", sub: "AI / General" }],
  // Fintech
  ["insurtech",            { parent: "Fintech", sub: "Insurance / Insurtech" }],
  ["wealthtech",           { parent: "Fintech", sub: "WealthTech" }],
  ["regtech",              { parent: "Fintech", sub: "RegTech" }],
  ["neobank",              { parent: "Fintech", sub: "Banking / Neobanking" }],
  ["digital bank",         { parent: "Fintech", sub: "Banking / Neobanking" }],
  ["payment",              { parent: "Fintech", sub: "Payments" }],
  ["lending",              { parent: "Fintech", sub: "Lending" }],
  ["credit",               { parent: "Fintech", sub: "Lending" }],
  ["blockchain",           { parent: "Fintech", sub: "Crypto / Web3" }],
  ["crypto",               { parent: "Fintech", sub: "Crypto / Web3" }],
  ["defi",                 { parent: "Fintech", sub: "Crypto / Web3" }],
  ["web3",                 { parent: "Fintech", sub: "Crypto / Web3" }],
  ["compliance",           { parent: "Fintech", sub: "RegTech" }],
  ["financial technology", { parent: "Fintech", sub: "Fintech / General" }],
  ["fintech",              { parent: "Fintech", sub: "Fintech / General" }],
  // Cybersecurity
  ["zero trust",           { parent: "Cybersecurity", sub: "Zero Trust" }],
  ["cloud security",       { parent: "Cybersecurity", sub: "Cloud Security" }],
  ["data security",        { parent: "Cybersecurity", sub: "Data Security" }],
  ["identity",             { parent: "Cybersecurity", sub: "Identity & Access" }],
  ["endpoint security",    { parent: "Cybersecurity", sub: "Endpoint Security" }],
  ["threat intelligence",  { parent: "Cybersecurity", sub: "Threat Intelligence" }],
  ["cybersecurity",        { parent: "Cybersecurity", sub: "Cybersecurity / General" }],
  ["information security", { parent: "Cybersecurity", sub: "Cybersecurity / General" }],
  // SaaS & Dev Tools
  ["developer tool",       { parent: "SaaS & Dev Tools", sub: "Developer Tools" }],
  ["devops",               { parent: "SaaS & Dev Tools", sub: "DevOps / CI-CD" }],
  ["api platform",         { parent: "SaaS & Dev Tools", sub: "API Platforms" }],
  ["low-code",             { parent: "SaaS & Dev Tools", sub: "Low-Code / No-Code" }],
  ["no-code",              { parent: "SaaS & Dev Tools", sub: "Low-Code / No-Code" }],
  ["data infrastructure",  { parent: "SaaS & Dev Tools", sub: "Data Infrastructure" }],
  ["data platform",        { parent: "SaaS & Dev Tools", sub: "Data Infrastructure" }],
  ["saas",                 { parent: "SaaS & Dev Tools", sub: "SaaS / General" }],
  // E-commerce & Retail
  ["supply chain",         { parent: "E-commerce & Retail", sub: "Logistics / Supply Chain" }],
  ["logistics",            { parent: "E-commerce & Retail", sub: "Logistics / Supply Chain" }],
  ["marketplace",          { parent: "E-commerce & Retail", sub: "Marketplaces" }],
  ["retail tech",          { parent: "E-commerce & Retail", sub: "Retail Tech" }],
  ["e-commerce",           { parent: "E-commerce & Retail", sub: "E-commerce / General" }],
  ["ecommerce",            { parent: "E-commerce & Retail", sub: "E-commerce / General" }],
  ["d2c",                  { parent: "E-commerce & Retail", sub: "D2C" }],
  // Health & Life Sciences
  ["digital health",       { parent: "Health & Life Sciences", sub: "Digital Health" }],
  ["healthtech",           { parent: "Health & Life Sciences", sub: "Digital Health" }],
  ["medtech",              { parent: "Health & Life Sciences", sub: "MedTech" }],
  ["medical device",       { parent: "Health & Life Sciences", sub: "MedTech" }],
  ["genomics",             { parent: "Health & Life Sciences", sub: "Biotech / Genomics" }],
  ["biotech",              { parent: "Health & Life Sciences", sub: "Biotech / Genomics" }],
  ["life sciences",        { parent: "Health & Life Sciences", sub: "Biotech / Genomics" }],
  ["mental health",        { parent: "Health & Life Sciences", sub: "Mental Health" }],
  ["healthcare",           { parent: "Health & Life Sciences", sub: "Healthcare SaaS" }],
  // Climate & Energy
  ["cleantech",            { parent: "Climate & Energy", sub: "CleanTech" }],
  ["clean energy",         { parent: "Climate & Energy", sub: "CleanTech" }],
  ["energytech",           { parent: "Climate & Energy", sub: "EnergyTech" }],
  ["renewable",            { parent: "Climate & Energy", sub: "EnergyTech" }],
  ["carbon",               { parent: "Climate & Energy", sub: "Carbon Markets" }],
  ["sustainability",       { parent: "Climate & Energy", sub: "Sustainability" }],
  ["climate tech",         { parent: "Climate & Energy", sub: "CleanTech" }],
  // Enterprise Software
  ["business intelligence", { parent: "Enterprise Software", sub: "Analytics / BI" }],
  ["analytics",            { parent: "Enterprise Software", sub: "Analytics / BI" }],
  ["human resources",      { parent: "Enterprise Software", sub: "HR Tech" }],
  ["hr tech",              { parent: "Enterprise Software", sub: "HR Tech" }],
  ["hrtech",               { parent: "Enterprise Software", sub: "HR Tech" }],
  ["crm",                  { parent: "Enterprise Software", sub: "CRM" }],
  ["erp",                  { parent: "Enterprise Software", sub: "ERP / Finance" }],
  ["enterprise",           { parent: "Enterprise Software", sub: "Enterprise / General" }],
  // Consumer & Media
  ["social media",         { parent: "Consumer & Media", sub: "Social Media" }],
  ["gaming",               { parent: "Consumer & Media", sub: "Gaming" }],
  ["game",                 { parent: "Consumer & Media", sub: "Gaming" }],
  ["edtech",               { parent: "Consumer & Media", sub: "EdTech" }],
  ["education",            { parent: "Consumer & Media", sub: "EdTech" }],
  ["travel",               { parent: "Consumer & Media", sub: "Travel & Hospitality" }],
  ["hospitality",          { parent: "Consumer & Media", sub: "Travel & Hospitality" }],
  ["media",                { parent: "Consumer & Media", sub: "Media / Content" }],
  ["content",              { parent: "Consumer & Media", sub: "Media / Content" }],
  // DeepTech
  ["quantum",              { parent: "DeepTech", sub: "Quantum Computing" }],
  ["robotics",             { parent: "DeepTech", sub: "Robotics" }],
  ["space tech",           { parent: "DeepTech", sub: "Space Tech" }],
  ["semiconductor",        { parent: "DeepTech", sub: "Semiconductors" }],
  ["deep tech",            { parent: "DeepTech", sub: "DeepTech / General" }],
  ["deeptech",             { parent: "DeepTech", sub: "DeepTech / General" }],
];

function classifyIndustry(industry: string | null): { parent: string; sub: string } {
  if (!industry) return { parent: "Uncategorized", sub: "Uncategorized" };
  const lower = industry.toLowerCase();
  for (const [keyword, mapping] of INDUSTRY_KEYWORD_MAP) {
    if (lower.includes(keyword)) return mapping;
  }
  // Word-boundary match for very short tokens (avoids substring false-positives)
  if (/\bai\b/.test(lower))   return { parent: "AI & ML",        sub: "AI / General" };
  if (/\bml\b/.test(lower))   return { parent: "AI & ML",        sub: "AI / General" };
  if (/\bllm\b/.test(lower))  return { parent: "AI & ML",        sub: "LLMs" };
  if (/\bnlp\b/.test(lower))  return { parent: "AI & ML",        sub: "NLP / Speech" };
  if (/\bsec\b/.test(lower) || /\biam\b/.test(lower)) return { parent: "Cybersecurity", sub: "Cybersecurity / General" };
  return { parent: "Uncategorized", sub: industry };   // preserve original value as the sub label
}

// Keywords from INDUSTRY_KEYWORD_MAP that resolve to a given {parent, sub} —
// used to build a server-side ILIKE-OR filter for sub-sector drill-down
// without duplicating the keyword map itself as SQL (only the parent-level
// bucket is ported server-side, via classify_sector_parent() in the DB).
function keywordsForSub(parent: string, sub: string): string[] {
  return INDUSTRY_KEYWORD_MAP
    .filter(([, mapping]) => mapping.parent === parent && mapping.sub === sub)
    .map(([keyword]) => keyword);
}

// ── Slider step definitions ───────────────────────────────────────────────────

const STAGE_STEPS = [
  { value: "all",       label: "All",        rounds: [] as RoundType[] },
  { value: "pre-seed",  label: "Pre-Seed",   rounds: ["Pre-Seed", "Convertible Note"] as RoundType[] },
  { value: "seed",      label: "Seed",       rounds: ["Seed", "Bridge"] as RoundType[] },
  { value: "series-a",  label: "Series A",   rounds: ["Series A"] as RoundType[] },
  { value: "series-b",  label: "Series B",   rounds: ["Series B"] as RoundType[] },
  { value: "growth",    label: "Growth/Late", rounds: ["Series C", "Series D", "Series E+", "Growth", "Acquired", "PE Buyout", "Secondary"] as RoundType[] },
] as const;
type StageStep = (typeof STAGE_STEPS)[number]["value"];

const HEADCOUNT_STEPS = [
  { value: "all",      label: "All" },
  { value: "0-50",     label: "≤ 50" },
  { value: "51-100",   label: "51-100" },
  { value: "101-250",  label: "101-250" },
  { value: "251-500",  label: "251-500" },
  { value: "500+",     label: "500+" },
] as const;
type HeadcountStep = (typeof HEADCOUNT_STEPS)[number]["value"];
type DensityFilter = "all" | "crowded" | "blue-ocean";

const PROGRESS_MESSAGES = [
  "Searching the web for funding data…",
  "Analyzing founding team & leadership…",
  "Identifying headquarters location…",
  "Scanning job boards for hiring signals…",
  "Validating entry conditions…",
  "Saving to AlphaMap…",
];

// ── Hierarchical Sector Filter ────────────────────────────────────────────────
// Tag/checkbox-style list for the sidebar: selecting a parent sector reveals
// its sub-sectors nested directly beneath it.

function HierarchicalSectorFilter({
  parentSector, onParentChange,
  subSector,    onSubChange,
}: {
  parentSector: string; onParentChange: (v: string) => void;
  subSector:    string; onSubChange:    (v: string) => void;
}) {
  const parents = Object.keys(SECTOR_TAXONOMY).filter((p) => p !== "Uncategorized");

  function selectParent(p: string) {
    onParentChange(parentSector === p ? "" : p);
    onSubChange("");
  }

  const rowBase = "w-full text-left px-2.5 py-1.5 rounded-[8px] text-xs font-semibold transition-colors flex items-center justify-between";
  const rowActive = "bg-[#0F172A] text-white";
  const rowPassive = "text-gray-600 hover:bg-gray-50";

  return (
    <div className="space-y-0.5 max-h-80 overflow-y-auto pr-1">
      <button onClick={() => selectParent("")} className={`${rowBase} ${!parentSector ? rowActive : rowPassive}`}>
        All Sectors
      </button>
      {parents.map((p) => {
        const subs = SECTOR_TAXONOMY[p] ?? [];
        const isActive = parentSector === p;
        return (
          <div key={p}>
            <button onClick={() => selectParent(p)} className={`${rowBase} ${isActive ? rowActive : rowPassive}`}>
              <span>{p}</span>
              {isActive && subs.length > 0 && <ChevronDown className="w-3 h-3 flex-none" />}
            </button>
            {isActive && subs.length > 0 && (
              <div className="ml-2.5 mt-1 mb-1.5 space-y-0.5 border-l-2 border-gray-100 pl-2.5">
                <button
                  onClick={() => onSubChange("")}
                  className={`w-full text-left px-2 py-1 rounded-[6px] text-[11px] transition-colors ${!subSector ? "text-[#0F172A] font-bold bg-gray-50" : "text-gray-500 font-medium hover:text-gray-700"}`}
                >
                  All {p}
                </button>
                {subs.map((s) => (
                  <button
                    key={s}
                    onClick={() => onSubChange(subSector === s ? "" : s)}
                    className={`w-full text-left px-2 py-1 rounded-[6px] text-[11px] transition-colors ${subSector === s ? "text-[#0F172A] font-bold bg-gray-50" : "text-gray-500 font-medium hover:text-gray-700"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button onClick={() => selectParent("Uncategorized")} className={`${rowBase} ${parentSector === "Uncategorized" ? rowActive : rowPassive}`}>
        Uncategorized
      </button>
    </div>
  );
}

// ── Country Filter (sidebar) ─────────────────────────────────────────────────
// Flat searchable tag list — countries have no hierarchy, unlike sectors.

function CountryFilterList({
  countries, value, onChange,
}: {
  countries: string[]; value: string; onChange: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => countries.filter((c) => c.toLowerCase().includes(query.toLowerCase())),
    [countries, query],
  );
  const rowBase = "w-full text-left px-2.5 py-1.5 rounded-[8px] text-xs font-semibold transition-colors";
  const rowActive = "bg-[#0F172A] text-white";
  const rowPassive = "text-gray-600 hover:bg-gray-50";

  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-300" />
        <input
          type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter countries…"
          className="w-full pl-7 pr-2 py-1.5 text-xs bg-gray-50 border border-gray-100 rounded-[8px] focus:outline-none focus:border-gray-300 focus:ring-2 focus:ring-[#0F172A]/10 transition-all"
        />
      </div>
      <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
        <button onClick={() => onChange("")} className={`${rowBase} ${!value ? rowActive : rowPassive}`}>All Countries</button>
        {filtered.map((c) => (
          <button key={c} onClick={() => onChange(value === c ? "" : c)} className={`${rowBase} ${value === c ? rowActive : rowPassive}`}>{c}</button>
        ))}
        {filtered.length === 0 && <p className="text-[11px] text-gray-300 px-2 py-1">No matches</p>}
      </div>
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

interface TimelinePoint {
  year: number; date: string; roundType: string;
  amount: number; cumulative: number; color: string;
}

function buildTimelineData(rounds: FundingRound[]): TimelinePoint[] {
  const sorted = [...rounds]
    .filter((r) => r.announcement_date && r.amount_raised && r.amount_raised > 0)
    .sort((a, b) => (a.announcement_date ?? "").localeCompare(b.announcement_date ?? ""));
  let cum = 0;
  return sorted.map((r) => {
    cum += r.amount_raised! / 1e6;
    return {
      year: new Date(r.announcement_date!).getFullYear(),
      date: r.announcement_date!,
      roundType: r.round_type ?? "Other",
      amount: r.amount_raised! / 1e6,
      cumulative: cum,
      color: ROUND_HEX[r.round_type ?? "Other"] ?? "#9CA3AF",
    };
  });
}

function TimelineTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: TimelinePoint }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#0F172A] text-white rounded-[10px] px-3 py-2.5 text-xs shadow-xl border border-white/10">
      <p className="font-bold mb-1" style={{ color: d.color }}>{d.roundType}</p>
      <p className="text-[#F59E0B]">+{fmtM(d.amount)} raised</p>
      <p className="text-gray-400">{fmtM(d.cumulative)} cumulative</p>
    </div>
  );
}

function FundingTimeline({ rounds }: { rounds: FundingRound[] }) {
  const data = useMemo(() => buildTimelineData(rounds), [rounds]);
  if (data.length < 2) return null;

  const maxVal    = data[data.length - 1].cumulative;
  const tickFmt   = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`;
  const domainMax = Math.ceil(maxVal * 1.3 / 50) * 50 || 10;

  return (
    <div className="mb-7">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-[#F59E0B]" />
        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Funding Timeline</h4>
        <span className="text-[9px] text-gray-300 ml-auto">Cumulative raised</span>
      </div>
      <div className="bg-gray-50 rounded-[16px] p-4 border border-gray-100">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="fundGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#F59E0B" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: "#6B7280", fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={tickFmt} tick={{ fill: "#9CA3AF", fontSize: 10 }} axisLine={false} tickLine={false} width={56} domain={[0, domainMax]} />
            <ReTooltip content={<TimelineTooltip />} cursor={{ stroke: "#F59E0B", strokeWidth: 1, strokeDasharray: "4 2" }} />
            <Area
              type="monotone" dataKey="cumulative"
              stroke="#F59E0B" strokeWidth={2} fill="url(#fundGrad)"
              dot={(props: { cx: number; cy: number; payload: TimelinePoint }) => (
                <circle key={props.payload.date} cx={props.cx} cy={props.cy} r={5}
                  fill={props.payload.color} stroke="#F9FAFB" strokeWidth={2} />
              )}
              activeDot={{ r: 7, fill: "#F59E0B", stroke: "#F9FAFB", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Growth Trend Badge ────────────────────────────────────────────────────────

function GrowthTrendBadge({ trend, light = false }: { trend: string | null | undefined; light?: boolean }) {
  if (!trend || trend === "unknown") return null;
  const cfgDark: Record<string, { Icon: React.ComponentType<{ className?: string }>; label: string; cls: string }> = {
    "rapid growth":    { Icon: TrendingUp,   label: "Rapid Growth",    cls: "bg-emerald-900/40 text-emerald-400 border-emerald-800/60" },
    "moderate growth": { Icon: TrendingUp,   label: "Moderate Growth", cls: "bg-blue-900/40 text-blue-400 border-blue-800/60" },
    "stable":          { Icon: Minus,        label: "Stable",          cls: "bg-slate-700/60 text-slate-300 border-slate-600/60" },
    "reduction":       { Icon: TrendingDown, label: "Reduction",       cls: "bg-red-900/40 text-red-400 border-red-800/60" },
  };
  const cfgLight: Record<string, { Icon: React.ComponentType<{ className?: string }>; label: string; cls: string }> = {
    "rapid growth":    { Icon: TrendingUp,   label: "Rapid Growth",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    "moderate growth": { Icon: TrendingUp,   label: "Moderate Growth", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    "stable":          { Icon: Minus,        label: "Stable",          cls: "bg-gray-100 text-gray-600 border-gray-200" },
    "reduction":       { Icon: TrendingDown, label: "Reduction",       cls: "bg-red-50 text-red-700 border-red-200" },
  };
  const c = (light ? cfgLight : cfgDark)[trend];
  if (!c) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border ${c.cls}`}>
      <c.Icon className="w-3 h-3" />{c.label}
    </span>
  );
}

// ── AlphaMap Score Components ─────────────────────────────────────────────────

function safeFixed(n: number | null | undefined, decimals: number, fallback = 'N/A'): string {
  return typeof n === 'number' && isFinite(n) ? n.toFixed(decimals) : fallback;
}

const TIER_CONFIG = {
  A: { ring: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700 border border-emerald-300', label: 'Tier A', bar: '#059669' },
  B: { ring: '#2563eb', bg: 'bg-blue-50',    border: 'border-blue-200',    badge: 'bg-blue-100 text-blue-700 border border-blue-300',       label: 'Tier B', bar: '#2563eb' },
  C: { ring: '#e11d48', bg: 'bg-rose-50',    border: 'border-rose-200',    badge: 'bg-rose-100 text-rose-700 border border-rose-300',       label: 'Tier C', bar: '#e11d48' },
} as const;

function ScoreRing({ score, tier }: { score: number | null; tier: 'A' | 'B' | 'C' }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const safeScore = typeof score === 'number' && isFinite(score) ? score : 0;
  const offset = circ * (1 - safeScore / 100);
  const cfg = TIER_CONFIG[tier];
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" className="flex-none">
      <circle cx="42" cy="42" r={r} fill="none" stroke="#E5E7EB" strokeWidth="7" />
      <circle
        cx="42" cy="42" r={r} fill="none"
        stroke={cfg.ring} strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 42 42)"
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
      <text x="42" y="44" textAnchor="middle" dominantBaseline="middle"
        fill="#111827" fontSize="16" fontWeight="700" fontFamily="inherit">
        {safeFixed(score, 0, '—')}
      </text>
    </svg>
  );
}

function AlphaMapScorePanel({ data, loading, err }: {
  data: AlphaScore | null; loading: boolean; err: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-gray-50 border border-gray-100 rounded-[14px] p-4 flex items-center gap-3">
        <Activity className="w-4 h-4 text-gray-400 animate-pulse" />
        <span className="text-xs text-gray-400">Calculating AlphaMap Score…</span>
      </div>
    );
  }
  if (err || !data || data.error || !data.pillars) {
    return (
      <div className="bg-gray-50 border border-gray-100 rounded-[14px] p-4 flex items-center gap-3">
        <Activity className="w-4 h-4 text-gray-300" />
        <span className="text-xs text-gray-400 italic">Score pending data enrichment</span>
      </div>
    );
  }

  const cfg = TIER_CONFIG[data.tier] ?? TIER_CONFIG['C'];
  const pillars = [
    { key: 'capital_efficiency', pillar: data.pillars?.capital_efficiency },
    { key: 'talent_velocity',    pillar: data.pillars?.talent_velocity },
    { key: 'ecosystem_signal',   pillar: data.pillars?.ecosystem_signal },
  ].filter((p): p is { key: string; pillar: NonNullable<typeof p.pillar> } => p.pillar != null);

  return (
    <div className={`rounded-[14px] border p-5 ${cfg.bg} ${cfg.border}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-gray-500" />
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">AlphaMap Score</h3>
        {data.archetype && (
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-white/70 text-gray-500 border border-black/5"
            title={
              data.archetype === 'mature_private'
                ? 'Scored on the mature-company track: absolute scale, longevity, headcount stability, and M&A activity — not funding velocity.'
                : 'Scored on the venture track: capital efficiency, headcount growth rate, and investor quality.'
            }
          >
            {data.archetype === 'mature_private' ? 'Mature Private' : 'Venture-Backed'}
          </span>
        )}
        <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
        <span className="text-[10px] text-gray-400 capitalize">{data.confidence} confidence</span>
      </div>

      {/* Score ring + right-side breakdown */}
      <div className="flex gap-5">
        {/* Ring */}
        <div className="flex flex-col items-center gap-1">
          <ScoreRing score={data.score} tier={data.tier} />
          <span className="text-[9px] text-gray-400 uppercase tracking-wider">Score</span>
        </div>

        {/* Pillar bars */}
        <div className="flex-1 flex flex-col justify-center gap-2.5">
          {pillars.map(({ pillar }) => (
            <div key={pillar.label}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-gray-500">{pillar.label}</span>
                <span className="text-[10px] font-semibold text-gray-900">
                  {pillar.valid && pillar.score != null ? safeFixed(pillar.score, 0, '—') : '—'}
                  <span className="text-gray-400 font-normal"> / {pillar.weight}%</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/60 overflow-hidden">
                {pillar.valid && pillar.score != null && (
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pillar.score}%`, backgroundColor: cfg.bar }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Macro adjustment + sector footer */}
      <div className="mt-3 pt-3 border-t border-black/5 flex items-center justify-between text-[10px] text-gray-500">
        <span>
          Base&nbsp;
          <span className="text-gray-700 font-semibold">{safeFixed(data.base_score, 1, '—')}</span>
          &nbsp;→ macro&nbsp;
          <span className={(data.macro_adj_pct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
            {(data.macro_adj_pct ?? 0) >= 0 ? '+' : ''}{safeFixed(data.macro_adj_pct, 1, '0')}%
          </span>
        </span>
        {data.sector_id && data.sector_id !== 'unknown' && (
          <span className="text-gray-400 capitalize">{data.sector_id.replace(/-/g, ' ')}</span>
        )}
      </div>

      {/* Hover popover: detailed breakdown per pillar (kept dark — a floating
          overlay pops the same way regardless of the page underneath) */}
      <div className="mt-3 group relative">
        <button className="text-[10px] text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1">
          <Info className="w-3 h-3" /> Pillar breakdown
        </button>
        <div className="absolute bottom-6 left-0 z-50 w-72 bg-[#060f1c] border border-[#1a2a3f] rounded-xl p-4 shadow-2xl
                        opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto
                        transition-opacity duration-150">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Pillar Details</p>
          {pillars.map(({ pillar }) => (
            <div key={pillar.label} className="mb-3 last:mb-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-slate-200">{pillar.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${pillar.valid ? cfg.badge : 'bg-slate-800 text-slate-500'}`}>
                  {pillar.valid && pillar.score != null ? safeFixed(pillar.score, 1, 'N/A') : 'N/A'}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 space-y-0.5">
                {pillar.detail?.value_creation_x != null && (
                  <div>Value creation: <span className="text-slate-300">{pillar.detail.value_creation_x.toFixed(2)}×</span></div>
                )}
                {pillar.detail?.burn_proxy_k != null && (
                  <div>Burn proxy: <span className="text-slate-300">${pillar.detail.burn_proxy_k.toFixed(0)}k/hire</span></div>
                )}
                {pillar.detail?.hc_growth_pct != null && (
                  <div>HC growth: <span className="text-slate-300">{pillar.detail.hc_growth_pct.toFixed(1)}%</span></div>
                )}
                {pillar.detail?.serial_founder != null && (
                  <div>Serial founder: <span className="text-slate-300">{pillar.detail.serial_founder ? 'Yes +10' : 'No'}</span></div>
                )}
                {pillar.detail?.investor_tier != null && (
                  <div>Investor tier score: <span className="text-slate-300">{pillar.detail.investor_tier}</span></div>
                )}
                {pillar.detail?.follow_on != null && (
                  <div>Follow-on investors: <span className="text-slate-300">{pillar.detail.follow_on ? 'Yes +10' : 'No'}</span></div>
                )}
                {pillar.detail?.n_investors != null && (
                  <div>Investors tracked: <span className="text-slate-300">{pillar.detail.n_investors} ({pillar.detail.n_matched ?? 0} ranked)</span></div>
                )}
                {pillar.detail?.tier != null && (
                  <div>Basis: <span className="text-slate-300 capitalize">{pillar.detail.tier.replace(/_/g, ' ')}</span></div>
                )}
              </div>
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-white/5 text-[10px] text-slate-500">
            Final = base × (1 + macro adj) — capped 1–100
          </div>
        </div>
      </div>
    </div>
  );
}

const SCORE_BADGE_STYLE: Record<'A'|'B'|'C', string> = {
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  B: 'bg-blue-50 text-blue-700 border-blue-200',
  C: 'bg-rose-50 text-rose-700 border-rose-200',
};

function ScoreBadge({ startupId }: { startupId: string }) {
  const [data, setData] = useState<AlphaScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlphaScore(startupId)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [startupId]);

  if (loading) {
    return <div className="h-4 w-12 rounded bg-gray-100 animate-pulse" />;
  }
  if (!data || data.error || data.score == null || !(data.tier in SCORE_BADGE_STYLE)) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${SCORE_BADGE_STYLE[data.tier as 'A'|'B'|'C']}`}>
      <Activity className="w-2.5 h-2.5 opacity-70" />
      {data.tier}&nbsp;{safeFixed(data.score, 0, 'N/A')}
    </span>
  );
}

// ── Talent & Growth Intelligence ─────────────────────────────────────────────
// NOTE: no simulated/fabricated headcount curve — if fewer than 2 real
// `headcount_history` snapshots exist for a company, the Talent & Growth tab
// renders an explicit "Data requires filling" state rather than guessing.

// Maps real HeadcountPoint rows → chart-friendly shape, choosing label precision
// based on the overall time span so x-axis labels never look crowded.
function realHistoryToChartPoints(
  points: HeadcountPoint[],
): Array<{ year: string; headcount: number }> {
  if (points.length === 0) return [];
  const first = new Date(points[0].recorded_date);
  const last  = new Date(points[points.length - 1].recorded_date);
  const spanYears = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 365);
  return points.map((p) => {
    const d = new Date(p.recorded_date);
    const label = spanYears >= 2
      ? String(d.getFullYear())
      : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    return { year: label, headcount: p.employee_count };
  });
}

// ── Shared tab primitives ─────────────────────────────────────────────────────

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

// Highly visible placeholder for any dataset that is null/empty/undefined in
// the DB. Per an explicit product decision, missing data is NEVER mocked,
// guessed, or auto-filled — it's surfaced so the admin/data team can see the
// gap and go fill it.
function MissingDataState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[14px] p-5 border border-dashed border-amber-400/60 bg-amber-50/60">
      <AlertCircle className="w-5 h-5 text-amber-600 flex-none mt-0.5" />
      <div>
        <p className="text-sm font-bold text-amber-800">Data requires filling</p>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

// ── Tab 1: Overview ───────────────────────────────────────────────────────────

function OverviewTab({
  startup, alphaScore, alphaLoading, alphaErr,
}: {
  startup: Startup; alphaScore: AlphaScore | null; alphaLoading: boolean; alphaErr: boolean;
}) {
  const location = [startup.city, startup.country].filter(Boolean).join(", ") || "—";
  const sector = classifyIndustry(startup.industry);

  return (
    <div className="space-y-6">
      {startup.description ? (
        <p className="text-sm text-gray-700 leading-relaxed">{startup.description}</p>
      ) : (
        <MissingDataState message="No company description on file." />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Calendar}  label="Founded"   value={startup.founded_year ? String(startup.founded_year) : "—"} accent="#F59E0B" />
        <StatCard icon={MapPin}    label="Location"  value={location} accent="#0e7490" />
        <StatCard icon={Users}     label="Employees" value={fmtEmp(startup.employee_count)} accent="#6d28d7" />
        <StatCard icon={Briefcase} label="Sector"    value={sector.parent} accent="#be185d" />
      </div>

      <AlphaMapScorePanel data={alphaScore} loading={alphaLoading} err={alphaErr} />

      {startup.leadership && startup.leadership.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Briefcase className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Leadership</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {startup.leadership.map((l, i) => (
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
        </div>
      )}

      {startup.founders && startup.founders.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <UserRound className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Founder{startup.founders.length > 1 ? "s" : ""}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {startup.founders.map((f, i) => (
              <span key={i} className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 text-sm font-medium text-gray-700 pl-3 pr-1.5 py-1.5 rounded-full">
                <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center text-[10px] font-black text-amber-700">
                  {f.name[0].toUpperCase()}
                </div>
                {f.name}
                <LinkedInBadge url={f.linkedin_url} name={f.name} />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Funding & Valuation ────────────────────────────────────────────────

function VerticalFundingTimeline({ rounds }: { rounds: FundingRound[] }) {
  const newestFirst = useMemo(
    () => [...rounds].sort((a, b) => (b.announcement_date ?? "").localeCompare(a.announcement_date ?? "")),
    [rounds],
  );

  return (
    <div className="relative">
      <div className="absolute left-[13px] top-2 bottom-2 w-px bg-gray-200" />
      <div className="space-y-4">
        {newestFirst.map((r, idx) => {
          const color = ROUND_HEX[r.round_type ?? "Other"] ?? "#9CA3AF";
          return (
            <div key={r.id ?? idx} className="relative pl-9">
              <div
                className="absolute left-0 top-1 w-[27px] h-[27px] rounded-full flex items-center justify-center border-2 bg-white"
                style={{ borderColor: color }}
              >
                <div className="w-2 h-2 rounded-full" style={{ background: color }} />
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-[14px] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.round_type && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROUND_STYLE[r.round_type] ?? ROUND_STYLE["Other"]}`}>
                          {r.round_type}
                        </span>
                      )}
                      {r.announcement_date && (
                        <span className="text-xs text-gray-400">
                          {new Date(r.announcement_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {r.amount_raised && (
                        <span className="text-xs text-gray-500">
                          <span className="font-bold text-gray-900">{fmt(r.amount_raised)}</span> raised
                        </span>
                      )}
                      {r.valuation && (
                        <span className="text-xs text-gray-500">
                          <span className="font-bold text-gray-900">{fmt(r.valuation)}</span>
                          {r.is_valuation_estimated && <span className="text-gray-400"> est.</span>} val.
                        </span>
                      )}
                    </div>
                    {r.lead_investor ? (
                      <span className="text-[10px] text-gray-400">
                        Lead: <span className="text-gray-600 font-medium">{r.lead_investor}</span>
                        {r.investors && r.investors.length > 1 && (
                          <span className="text-gray-300"> +{r.investors.length - 1} more</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-300 italic">Investor data requires filling</span>
                    )}
                  </div>
                  {r.source_url && (
                    <a href={r.source_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-[#F59E0B] hover:underline font-medium flex-none">
                      Source <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FundingValuationTab({ sortedRounds, fundingHistoryComplete }: { sortedRounds: FundingRound[]; fundingHistoryComplete?: boolean | null }) {
  const latestRound = sortedRounds[sortedRounds.length - 1] ?? null;
  const raised = sortedRounds.reduce((sum, r) => sum + (r.amount_raised ?? 0), 0);

  return (
    <div className="space-y-6">
      {fundingHistoryComplete === false && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-[12px] px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-none mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            <span className="font-bold">Funding history may be incomplete.</span> Research found signs of earlier rounds (e.g. a later-stage round with no matching Seed/Series A, or a source citing more total rounds than could be verified) that couldn't be confirmed in detail — the rounds below may not be the full story.
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={DollarSign} label="Total Raised"     value={raised ? fmt(raised) : "—"} accent="#F59E0B" />
        <StatCard icon={TrendingUp} label="Latest Valuation" value={fmt(latestRound?.valuation)} accent="#0e7490" />
        <StatCard icon={Clock}      label="Last Round Type"  value={latestRound?.round_type ?? "—"} accent="#6d28d7" />
      </div>

      {sortedRounds.length >= 2 && <FundingTimeline rounds={sortedRounds} />}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Funding Timeline</h3>
        </div>
        {sortedRounds.length === 0 ? (
          <MissingDataState message="No funding rounds have been recorded for this company yet." />
        ) : (
          <VerticalFundingTimeline rounds={sortedRounds} />
        )}
      </div>
    </div>
  );
}

// ── Tab 3: Cap Table & Investors ──────────────────────────────────────────────

const CAP_TABLE_TIER_STYLE: Record<number, { label: string; cls: string; dot: string }> = {
  1: { label: "Tier 1 · Top-Tier",  cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "#B45309" },
  2: { label: "Tier 2 · Mid-Tier",  cls: "bg-cyan-50 text-cyan-700 border-cyan-200",     dot: "#0e7490" },
  3: { label: "Tier 3 · Long-Tail", cls: "bg-gray-100 text-gray-500 border-gray-200",    dot: "#6B7280" },
};
const CAP_TABLE_UNRANKED = { label: "Unranked", cls: "bg-gray-50 text-gray-400 border-gray-200", dot: "#9CA3AF" };

interface InvestorScheduleEntry {
  name: string;
  isLead: boolean;
  roundCount: number;
  // Sum of disclosed per-round investor_amounts for this name. null means no
  // per-investor split was ever disclosed — NOT that they invested nothing.
  totalAmount: number | null;
}

// Aggregates every named investor across a company's full funding history —
// the investor schedule. Per-investor totals only include amounts explicitly
// disclosed per round (funding_rounds.investor_amounts); most rounds only
// disclose the round total, so totalAmount is commonly null even for an
// active lead investor.
function buildInvestorSchedule(rounds: FundingRound[]): InvestorScheduleEntry[] {
  const byName = new Map<string, InvestorScheduleEntry>();
  for (const r of rounds) {
    const lead = r.lead_investor?.trim();
    const names = new Set<string>();
    if (lead) names.add(lead);
    for (const inv of r.investors ?? []) {
      const name = inv?.trim();
      if (name) names.add(name);
    }
    const amountByName = new Map<string, number>();
    for (const a of r.investor_amounts ?? []) {
      if (a?.name && typeof a.amount === "number") amountByName.set(a.name.trim().toLowerCase(), a.amount);
    }
    for (const name of names) {
      const key = name.toLowerCase();
      const entry = byName.get(key) ?? { name, isLead: false, roundCount: 0, totalAmount: null };
      entry.roundCount += 1;
      if (name === lead) entry.isLead = true;
      const amt = amountByName.get(key);
      if (amt != null) entry.totalAmount = (entry.totalAmount ?? 0) + amt;
      byName.set(key, entry);
    }
  }
  return Array.from(byName.values()).sort((a, b) => {
    if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;
    if (a.totalAmount != null && b.totalAmount != null) return b.totalAmount - a.totalAmount;
    if (a.totalAmount != null) return -1;
    if (b.totalAmount != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

function CapTableInvestorRow({ entry, tierMap }: { entry: InvestorScheduleEntry; tierMap: Map<string, number> | null }) {
  const tier = tierMap?.get(entry.name.toLowerCase()) ?? null;
  const style = tier != null ? CAP_TABLE_TIER_STYLE[tier] : CAP_TABLE_UNRANKED;
  return (
    <div className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-[12px] px-4 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black flex-none"
          style={{ background: `${style.dot}18`, border: `1px solid ${style.dot}40`, color: style.dot }}
        >
          {entry.name[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-gray-900 truncate">{entry.name}</span>
            {entry.isLead && <Zap className="w-3 h-3 text-[#F59E0B] flex-none" />}
          </div>
          <span className="text-[10px] text-gray-400">{entry.roundCount} round{entry.roundCount === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-none">
        <span className="text-xs font-bold text-gray-700 whitespace-nowrap">{entry.totalAmount != null ? fmt(entry.totalAmount) : "—"}</span>
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${style.cls}`}>{style.label}</span>
      </div>
    </div>
  );
}

function CapTableTab({ startup }: { startup: Startup }) {
  const [tierMap, setTierMap] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    fetchInvestorTierMap().then(setTierMap).catch(() => setTierMap(new Map()));
  }, []);

  const schedule = useMemo(
    () => buildInvestorSchedule(startup.funding_rounds ?? []),
    [startup.funding_rounds],
  );
  const totalRaised = useMemo(
    () => (startup.funding_rounds ?? []).reduce((sum, r) => sum + (r.amount_raised ?? 0), 0),
    [startup.funding_rounds],
  );

  if (schedule.length === 0) {
    return <MissingDataState message="No investors are linked to this company's funding rounds yet — the cap table has not been ingested." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-[14px] px-4 py-3.5">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total Raised</span>
        <span className="text-lg font-black text-gray-900">{totalRaised > 0 ? fmt(totalRaised) : "—"}</span>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Investor Schedule</h3>
        </div>
        <div className="space-y-2">
          {schedule.map((e) => <CapTableInvestorRow key={e.name} entry={e} tierMap={tierMap} />)}
        </div>
      </div>
      <p className="text-[10px] text-gray-400 italic flex items-center gap-1.5">
        <Info className="w-3 h-3 flex-none" />
        Per-investor amounts (⚡ = lead) are shown only when specifically disclosed in research — most rounds only report the round total, so "—" means the split wasn't public, not zero investment. Investor tier is looked up from the AlphaMap investor directory — firms not yet tracked there show as "Unranked".
      </p>
    </div>
  );
}

// ── Tab 4: Talent & Growth ─────────────────────────────────────────────────────

function TalentGrowthTab({
  startup, alphaScore, alphaLoading,
}: {
  startup: Startup; alphaScore: AlphaScore | null; alphaLoading: boolean;
}) {
  const [realPts, setRealPts] = useState<HeadcountPoint[] | null>(null);

  useEffect(() => {
    setRealPts(null);
    fetchHeadcountHistory(startup.id).then(setRealPts).catch(() => setRealPts([]));
  }, [startup.id]);

  const chartData = realPts && realPts.length >= 2 ? realHistoryToChartPoints(realPts) : null;
  const talentPillar = alphaScore?.pillars?.talent_velocity ?? null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={Users}    label="Employees"      value={fmtEmp(startup.employee_count)} accent="#0e7490" />
        <StatCard icon={Activity} label="Talent Velocity" accent="#6d28d7"
          value={talentPillar?.valid && talentPillar.score != null ? `${safeFixed(talentPillar.score, 0)} / 100` : "—"} />
        <div className="rounded-[14px] p-4 flex flex-col gap-2 border bg-gray-50 border-gray-100">
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Growth Trend</span>
          <GrowthTrendBadge trend={startup.growth_trend} light />
          {(!startup.growth_trend || startup.growth_trend === "unknown") && (
            <span className="text-sm font-bold text-gray-400">—</span>
          )}
        </div>
      </div>

      {!alphaLoading && talentPillar && (
        <div className="bg-gray-50 border border-gray-100 rounded-[14px] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-[#6d28d7]" />
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Talent Velocity Breakdown</h3>
          </div>
          <div className="text-[11px] text-gray-500 space-y-1.5">
            {talentPillar.detail?.hc_growth_pct != null && (
              <div>Headcount growth: <span className="text-gray-700 font-medium">{talentPillar.detail.hc_growth_pct.toFixed(1)}%</span></div>
            )}
            {talentPillar.detail?.serial_founder != null && (
              <div>Serial founder bonus: <span className="text-gray-700 font-medium">{talentPillar.detail.serial_founder ? "Yes (+10)" : "No"}</span></div>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Headcount History</h3>
        </div>
        {chartData ? (
          <div className="bg-gray-50 border border-gray-100 rounded-[14px] p-4">
            <div className="flex justify-end mb-2">
              <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full border text-emerald-700 bg-emerald-50 border-emerald-200">
                Live data
              </span>
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hcGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0e7490" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#0e7490" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="year" tick={{ fill: "#9CA3AF", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#9CA3AF", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtEmp(v)} />
                  <ReTooltip
                    contentStyle={{ background: "#0b1626", border: "1px solid #1a2a3f", borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: "#94a3b8" }}
                    itemStyle={{ color: "#22d3ee" }}
                  />
                  <Area type="monotone" dataKey="headcount" stroke="#0e7490" strokeWidth={1.5} fill="url(#hcGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <MissingDataState message="No historical headcount snapshots have been recorded for this company yet — at least 2 data points are needed to plot a trend." />
        )}
      </div>
    </div>
  );
}

// ── Tab 5: Competitors & Market ────────────────────────────────────────────────
// Renders startup.competitors — auto-populated by scripts/bulk_enrich_all.ts
// with 4-5 direct competitors and an explanation of how each one competes.
// Any pre-existing manually-curated entries are preserved as-is by the
// pipeline's fill-null write policy. Handles both the structured object shape
// and the legacy plain-string shape (rows written before the format landed).

function normalizeCompetitor(c: Competitor | string): Competitor {
  if (typeof c === "string") return { name: c, how_it_competes: "", website: null, startup_id: null };
  return c;
}

function CompetitorsMarketTab({ startup, onNavigate }: { startup: Startup; onNavigate: (id: string) => void }) {
  const competitors = (startup.competitors ?? []).filter(Boolean).map(normalizeCompetitor);

  if (competitors.length === 0) {
    return (
      <MissingDataState message="No competitor relationships have been mapped for this company yet." />
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {competitors.map((c, idx) => {
        const linked = Boolean(c.startup_id);
        return (
          <div
            key={`${c.name}-${idx}`}
            className={`flex flex-col gap-1.5 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 ${linked ? "cursor-pointer hover:border-cyan-300 hover:bg-cyan-50/40 transition-colors" : ""}`}
            onClick={linked ? () => onNavigate(c.startup_id as string) : undefined}
          >
            <div className="flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-gray-400 flex-none" />
              <span className="text-sm font-bold text-gray-900 truncate">{c.name}</span>
              {linked && <span className="text-[10px] font-semibold text-cyan-700 bg-cyan-100 rounded-full px-2 py-0.5 flex-none">Tracked ↗</span>}
            </div>
            {c.how_it_competes && (
              <p className="text-xs text-gray-600 leading-relaxed">{c.how_it_competes}</p>
            )}
            {c.website && !linked && (
              <a
                href={c.website.startsWith("http") ? c.website : `https://${c.website}`}
                target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-cyan-700 transition-colors"
              >
                <Globe className="w-3 h-3 flex-none" />{c.website.replace(/^https?:\/\//, "").replace(/^www\./, "")}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Tab 6: Acquisitions & IP ───────────────────────────────────────────────────
// Renders startup.acquisitions (companies THIS company bought — outbound only)
// and startup.patent_count/patent_fields. Both are best-effort: an empty/null
// state here is the common, correct answer for most companies, not missing data.

function AcquisitionsIPTab({ startup, onNavigate }: { startup: Startup; onNavigate: (id: string) => void }) {
  const acquisitions = (startup.acquisitions ?? []).filter(Boolean);
  const hasPatents = startup.patent_count != null;

  if (acquisitions.length === 0 && !hasPatents) {
    return <MissingDataState message="No acquisitions or patent data have been found for this company yet." />;
  }

  return (
    <div className="space-y-6">
      {hasPatents && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-4 h-4 text-[#6d28d7]" />
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Patent Portfolio</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <StatCard icon={Award} label="Patents Held" value={String(startup.patent_count)} accent="#6d28d7" />
          </div>
          {startup.patent_fields && startup.patent_fields.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {startup.patent_fields.map((f) => (
                <span key={f} className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200">{f}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {acquisitions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Acquisitions</h3>
          </div>
          <div className="space-y-2">
            {acquisitions.map((a, idx) => {
              const linked = Boolean(a.acquired_startup_id);
              return (
                <div
                  key={`${a.company_name}-${idx}`}
                  className={`flex flex-col gap-1.5 bg-gray-50 border border-gray-100 rounded-[14px] px-4 py-3.5 ${linked ? "cursor-pointer hover:border-cyan-300 hover:bg-cyan-50/40 transition-colors" : ""}`}
                  onClick={linked ? () => onNavigate(a.acquired_startup_id as string) : undefined}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-bold text-gray-900 truncate">{a.company_name}</span>
                      {linked && <span className="text-[10px] font-semibold text-cyan-700 bg-cyan-100 rounded-full px-2 py-0.5 flex-none">Tracked ↗</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-none">
                      {a.amount != null && <span className="text-xs font-bold text-gray-700 whitespace-nowrap">{fmt(a.amount)}</span>}
                      {a.acquired_date && <span className="text-[10px] text-gray-400 whitespace-nowrap">{a.acquired_date.slice(0, 4)}</span>}
                    </div>
                  </div>
                  {a.description && <p className="text-xs text-gray-600 leading-relaxed">{a.description}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tearsheet Modal ───────────────────────────────────────────────────────────

type TearsheetTab = "overview" | "funding" | "captable" | "talent" | "competitors" | "acquisitions";

const TEARSHEET_TABS: { id: TearsheetTab; label: string }[] = [
  { id: "overview",    label: "Overview" },
  { id: "funding",     label: "Funding & Valuation" },
  { id: "captable",    label: "Cap Table & Investors" },
  { id: "talent",      label: "Talent & Growth" },
  { id: "competitors", label: "Competitors & Market" },
  { id: "acquisitions", label: "Acquisitions & IP" },
];

// ── Paywall gate for tearsheet tabs beyond Overview ──────────────────────────
// Presentation-layer gate only (see src/lib/plan.ts for why) — renders the
// real tab underneath a blur rather than hiding it outright, so a free user
// can see there's real depth here, then prompts them straight to Pricing.
const LOCKED_TAB_COPY: Record<Exclude<TearsheetTab, "overview">, string> = {
  funding:      "Unlock the complete funding timeline — every round from Pre-Seed/Seed through Series A and beyond, with valuations and investor amounts.",
  captable:     "See every investor on the cap table, lead vs. participating, and check sizes per round.",
  talent:       "Track headcount history and hiring trend signals over time, not just a single current number.",
  competitors:  "Explore mapped competitors and exactly how each one competes.",
  acquisitions: "View this company's acquisitions history and IP/patent signals.",
};

function LockedTab({ tab, children }: { tab: Exclude<TearsheetTab, "overview">; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="relative">
      <div className="pointer-events-none select-none max-h-[420px] overflow-hidden" style={{ filter: "blur(6px)" }} aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <div className="flex flex-col items-center text-center max-w-sm rounded-[20px] border border-gray-100 bg-white/95 backdrop-blur-sm shadow-[0_20px_50px_rgba(15,23,42,0.12)] p-6">
          <div className="w-11 h-11 rounded-full bg-[#0F172A] flex items-center justify-center mb-4">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <p className="text-sm font-bold text-[#0F172A]">This is a Pro feature</p>
          <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{LOCKED_TAB_COPY[tab]}</p>
          <button
            onClick={() => navigate("/pricing")}
            className="mt-4 flex items-center gap-1.5 rounded-[12px] bg-[#0F172A] px-4 py-2.5 text-xs font-bold text-white hover:bg-gray-900 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}

function TearsheetModal({ startup, onClose, onNavigate }: { startup: StartupListRow; onClose: () => void; onNavigate: (row: StartupListRow) => void }) {
  const [activeTab, setActiveTab] = useState<TearsheetTab>("overview");
  const [navLoading, setNavLoading] = useState(false);
  const { plan } = useUserPlan();
  const hasFullAccess = isPaidPlan(plan);

  async function handleNavigateToLinked(id: string) {
    if (navLoading) return;
    setNavLoading(true);
    try {
      const row = await fetchStartupListRowById(id);
      if (row) onNavigate(row);
    } catch (err) {
      console.error("Failed to load linked competitor:", err);
    } finally {
      setNavLoading(false);
    }
  }

  const roundType   = startup.latest_round_type ?? null;
  const roundStyle  = roundType ? (ROUND_STYLE[roundType] ?? ROUND_STYLE["Other"]) : null;
  const location    = [startup.city, startup.country].filter(Boolean).join(", ") || null;

  // The list only carries a lightweight summary row (no funding_rounds), so
  // the full record — including every round, needed by the Funding/Cap Table
  // tabs — is fetched on demand the moment the tearsheet opens.
  const [detail, setDetail]             = useState<Startup | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailErr, setDetailErr]       = useState(false);

  useEffect(() => {
    setDetail(null); setDetailLoading(true); setDetailErr(false);
    fetchStartupDetail(startup.id)
      .then(setDetail)
      .catch(() => setDetailErr(true))
      .finally(() => setDetailLoading(false));
  }, [startup.id]);

  const sortedRounds = useMemo(
    () => [...(detail?.funding_rounds ?? [])].sort(
      (a, b) => (a.announcement_date ?? "").localeCompare(b.announcement_date ?? ""),
    ),
    [detail],
  );

  // AlphaMap Score is fetched once here and shared by Overview + Talent tabs
  // so switching tabs doesn't re-trigger the RPC call.
  const [alphaScore, setAlphaScore]     = useState<AlphaScore | null>(null);
  const [alphaLoading, setAlphaLoading] = useState(true);
  const [alphaErr, setAlphaErr]         = useState(false);

  useEffect(() => {
    setAlphaLoading(true); setAlphaErr(false); setAlphaScore(null);
    fetchAlphaScore(startup.id)
      .then(setAlphaScore)
      .catch(() => setAlphaErr(true))
      .finally(() => setAlphaLoading(false));
  }, [startup.id]);

  useEffect(() => { setActiveTab("overview"); }, [startup.id]);

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
        {/* ── Fixed header (blue-gray) ── */}
        <div className="flex-none px-6 pt-5 pb-4 rounded-t-[24px]"
          style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
          <div className="flex items-start gap-4">
            <CompanyLogo name={startup.name} website={startup.website} size={52} rounded="rounded-2xl" />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black text-[#0F172A] tracking-tight leading-none mb-1.5 truncate">{startup.name}</h2>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#0F172A]/60">
                {location && (
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3 flex-none" />{location}</span>
                )}
                {startup.founded_year && (
                  <>
                    <span className="text-[#0F172A]/30">·</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3 flex-none" />Est. {startup.founded_year}</span>
                  </>
                )}
                {startup.website && (
                  <>
                    <span className="text-[#0F172A]/30">·</span>
                    <a href={startup.website} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 hover:text-cyan-700 transition-colors">
                      <Globe className="w-3 h-3 flex-none" />Website
                    </a>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-none">
              {roundType && roundStyle && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap bg-white/70`} style={{ border: "1px solid rgba(15,23,42,0.12)" }}>{roundType}</span>
              )}
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
            {TEARSHEET_TABS.map((tab) => {
              const active = activeTab === tab.id;
              const locked = tab.id !== "overview" && !hasFullAccess;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative flex-none flex items-center gap-1.5 px-4 py-3.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors"
                  style={{ color: active ? "#0F172A" : "rgba(15,23,42,0.55)" }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "rgba(15,23,42,0.8)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "rgba(15,23,42,0.55)"; }}
                >
                  {locked && <Lock className="w-3 h-3 flex-none opacity-60" />}
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
          {detailLoading ? (
            <div className="flex items-center justify-center py-32"><Loader2 className="w-6 h-6 text-[#F59E0B] animate-spin" /></div>
          ) : detailErr || !detail ? (
            <div className="flex flex-col items-center py-24 gap-3 text-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm font-semibold text-[#0F172A]">Failed to load company details</p>
            </div>
          ) : (
            <>
              {activeTab === "overview" && (
                <OverviewTab startup={detail} alphaScore={alphaScore} alphaLoading={alphaLoading} alphaErr={alphaErr} />
              )}
              {activeTab === "funding" && (
                hasFullAccess ? (
                  <FundingValuationTab sortedRounds={sortedRounds} fundingHistoryComplete={detail.funding_history_complete} />
                ) : (
                  <LockedTab tab="funding">
                    <FundingValuationTab sortedRounds={sortedRounds} fundingHistoryComplete={detail.funding_history_complete} />
                  </LockedTab>
                )
              )}
              {activeTab === "captable" && (
                hasFullAccess ? <CapTableTab startup={detail} /> : (
                  <LockedTab tab="captable"><CapTableTab startup={detail} /></LockedTab>
                )
              )}
              {activeTab === "talent" && (
                hasFullAccess ? (
                  <TalentGrowthTab startup={detail} alphaScore={alphaScore} alphaLoading={alphaLoading} />
                ) : (
                  <LockedTab tab="talent">
                    <TalentGrowthTab startup={detail} alphaScore={alphaScore} alphaLoading={alphaLoading} />
                  </LockedTab>
                )
              )}
              {activeTab === "competitors" && (
                hasFullAccess ? (
                  <CompetitorsMarketTab startup={detail} onNavigate={handleNavigateToLinked} />
                ) : (
                  <LockedTab tab="competitors">
                    <CompetitorsMarketTab startup={detail} onNavigate={handleNavigateToLinked} />
                  </LockedTab>
                )
              )}
              {activeTab === "acquisitions" && (
                hasFullAccess ? (
                  <AcquisitionsIPTab startup={detail} onNavigate={handleNavigateToLinked} />
                ) : (
                  <LockedTab tab="acquisitions">
                    <AcquisitionsIPTab startup={detail} onNavigate={handleNavigateToLinked} />
                  </LockedTab>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Comparison Modal ──────────────────────────────────────────────────────────

function CompareModal({
  startups, onClose, onAddPeer,
}: {
  startups: StartupListRow[];
  onClose: () => void; onAddPeer: (s: StartupListRow) => void;
}) {
  // Suggested peers are resolved server-side (same sector_parent + stage
  // bucket) instead of scanning the full in-memory dataset — required now
  // that only the current page of startups is ever held client-side.
  const [peers, setPeers] = useState<StartupListRow[]>([]);
  const [peersLoading, setPeersLoading] = useState(true);

  useEffect(() => {
    setPeersLoading(true);
    fetchSuggestedPeers(startups[0].id, startups.map((s) => s.id), 3)
      .then(setPeers)
      .catch(() => setPeers([]))
      .finally(() => setPeersLoading(false));
  }, [startups]);

  const chartData = startups.map((s) => ({
    name:  s.name.length > 10 ? s.name.slice(0, 9) + "…" : s.name,
    total: s.total_raised / 1e6,
    color: ROUND_HEX[s.latest_round_type ?? "Other"] ?? "#9CA3AF",
  }));

  const rows: Array<{ label: string; values: React.ReactNode[] }> = [
    { label: "Stage",       values: startups.map((s) => { const rt = s.latest_round_type; return rt ? <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROUND_STYLE[rt] ?? ROUND_STYLE["Other"]}`}>{rt}</span> : <span className="text-slate-600">—</span>; }) },
    { label: "Total Raised",values: startups.map((s) => <span className="font-bold text-white">{s.total_raised ? fmt(s.total_raised) : "—"}</span>) },
    { label: "Valuation",   values: startups.map((s) => <span className="font-bold text-white">{fmt(s.latest_valuation)}</span>) },
    { label: "Employees",   values: startups.map((s) => <div className="flex flex-col items-center gap-1"><span className="font-bold text-white">{fmtEmp(s.employee_count)}</span>{s.growth_trend && <GrowthTrendBadge trend={s.growth_trend} />}</div>) },
    { label: "Sector",      values: startups.map((s) => { const t = classifyIndustry(s.industry); return <div className="text-center"><div className="text-xs text-slate-300">{t.parent}</div><div className="text-[9px] text-slate-500">{t.sub !== t.parent && t.sub !== "Uncategorized" ? t.sub : ""}</div></div>; }) },
    { label: "Location",    values: startups.map((s) => <span className="text-slate-300 text-xs">{[s.city, s.country].filter(Boolean).join(", ") || "—"}</span>) },
    { label: "Founded",     values: startups.map((s) => <span className="text-slate-300">{s.founded_year ?? "—"}</span>) },
  ];

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0b1626] rounded-[24px] shadow-[0_32px_80px_rgba(0,0,0,0.7)] w-full max-w-3xl max-h-[92vh] overflow-y-auto border border-[#1a2a3f]">
        <div className="sticky top-0 z-10 bg-[#060e1a] rounded-t-[24px] px-7 py-5 border-b border-[#1a2a3f] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitCompare className="w-5 h-5 text-[#F59E0B]" />
            <h2 className="text-base font-bold text-white">Comparing {startups.length} Companies</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors">
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
        <div className="p-7 space-y-8">
          {/* Company headers */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `140px repeat(${startups.length}, 1fr)` }}>
            <div />
            {startups.map((s) => (
              <div key={s.id} className="flex flex-col items-center gap-2 text-center">
                <CompanyLogo name={s.name} website={s.website} size={40} rounded="rounded-xl" />
                <span className="text-sm font-bold text-white leading-tight">{s.name}</span>
              </div>
            ))}
          </div>
          {/* Metrics table */}
          <div className="bg-[#091422] border border-[#1a2a3f] rounded-[16px] overflow-hidden">
            {rows.map((row, i) => (
              <div key={row.label} className={`grid items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-[#1a2a3f]" : ""}`}
                style={{ gridTemplateColumns: `140px repeat(${startups.length}, 1fr)` }}>
                <span className="text-xs font-semibold text-slate-500">{row.label}</span>
                {row.values.map((v, j) => <div key={j} className="flex justify-center">{v}</div>)}
              </div>
            ))}
          </div>
          {/* Bar chart */}
          {chartData.some((d) => d.total > 0) && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Total Capital Raised</h3>
              <div className="bg-[#091422] border border-[#1a2a3f] rounded-[16px] p-4">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap="40%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2a3f" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => `$${v}M`} tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} width={50} />
                    <ReTooltip formatter={(v: number) => [`$${v.toFixed(0)}M total raised`, ""]}
                      contentStyle={{ background: "#0F172A", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, fontSize: 12 }}
                      labelStyle={{ color: "#fff", fontWeight: 700 }} itemStyle={{ color: "#F59E0B" }} cursor={{ fill: "#0d1f35" }} />
                    <Bar dataKey="total" radius={[6, 6, 0, 0]} maxBarSize={64}>
                      {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {/* Peer suggestions */}
          {peersLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />Finding peers…
            </div>
          ) : peers.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Suggested Peers <span className="text-slate-600 font-medium normal-case">· same sector &amp; stage</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {peers.map((peer) => (
                  <button key={peer.id} onClick={() => onAddPeer(peer)} disabled={startups.length >= 3}
                    className="flex items-center gap-2 bg-[#091422] border border-[#1a2a3f] hover:border-[#243858] disabled:opacity-40 disabled:cursor-not-allowed rounded-[12px] px-3 py-2 transition-colors">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black flex-none ${avatarColor(peer.name)}`}>{peer.name[0]}</div>
                    <div className="text-left">
                      <div className="text-xs font-bold text-white">{peer.name}</div>
                      <div className="text-[9px] text-slate-500">{peer.industry}</div>
                    </div>
                    <Plus className="w-3 h-3 text-slate-500" />
                  </button>
                ))}
              </div>
              {startups.length >= 3 && (
                <p className="text-xs text-slate-600 mt-2">Maximum 3 companies. Deselect one to add another.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Grid Card ─────────────────────────────────────────────────────────────────

function StartupCard({
  startup, onSelect, selected, onToggleSelect,
}: {
  startup: StartupListRow; onSelect: () => void;
  selected: boolean; onToggleSelect: (e: React.MouseEvent) => void;
}) {
  const roundType   = startup.latest_round_type ?? null;
  const location    = [startup.city, startup.country].filter(Boolean).join(", ") || null;
  const cardGlow    = roundType ? (ROUND_GLOW[roundType] ?? ROUND_GLOW.default) : ROUND_GLOW.default;

  return (
    <div
      onClick={onSelect}
      className="relative flex flex-col overflow-hidden cursor-pointer group rounded-[22px] border transition-all duration-300 bg-white"
      style={{
        borderColor: selected ? '#0F172A' : '#E5E7EB',
        boxShadow: selected
          ? `0 0 0 1px #0F172A, 0 4px 16px rgba(15,23,42,0.15)`
          : '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
        willChange: 'transform',
      }}
      onMouseEnter={(e) => {
        if (selected) return;
        const el = e.currentTarget;
        el.style.transform = 'translateY(-3px)';
        el.style.borderColor = cardGlow.border;
        el.style.boxShadow = `0 16px 40px rgba(15,23,42,0.10), 0 0 0 1px ${cardGlow.border}`;
      }}
      onMouseLeave={(e) => {
        if (selected) return;
        const el = e.currentTarget;
        el.style.transform = '';
        el.style.borderColor = '#E5E7EB';
        el.style.boxShadow = '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)';
      }}
    >
      {/* Top shimmer line — color keyed to funding stage */}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none z-10"
        style={{ background: `linear-gradient(90deg, transparent, ${cardGlow.shimmer}, transparent)` }}
      />
      <div className="p-5 pb-4 flex-1 relative z-10">
        <div className="flex items-start gap-3 mb-3">
          <CompanyLogo name={startup.name} website={startup.website} size={40} rounded="rounded-xl" />
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-bold text-gray-900 truncate leading-tight">
              {startup.name}
            </h3>
            {startup.industry && (
              <span className="text-xs text-gray-500 font-medium">{startup.industry}</span>
            )}
          </div>
          {roundType && (
            <span className={`flex-none text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${ROUND_STYLE[roundType] ?? ROUND_STYLE["Other"]}`}>{roundType}</span>
          )}
        </div>
        {startup.description && (
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-4">{startup.description}</p>
        )}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="rounded-[10px] px-3 py-2 bg-gray-50 border border-gray-100">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Valuation</div>
            <div className="text-sm font-bold text-gray-900">{fmt(startup.latest_valuation)}</div>
          </div>
          <div className="rounded-[10px] px-3 py-2 bg-gray-50 border border-gray-100">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Raised</div>
            <div className="text-sm font-bold text-gray-900">{fmt(startup.total_raised) || "—"}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500 mb-3">
          {location    && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{location}</span>}
          {startup.employee_count && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{fmtEmp(startup.employee_count)} emp</span>}
          {startup.founded_year   && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{startup.founded_year}</span>}
        </div>
        {startup.founders && startup.founders.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {startup.founders.slice(0, 3).map((f, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px] font-semibold text-gray-600 px-2 py-1 rounded-full bg-gray-50 border border-gray-200">
                <div className="w-3.5 h-3.5 rounded-full bg-amber-100 flex items-center justify-center text-[8px] font-black text-amber-700">
                  {f.name[0].toUpperCase()}
                </div>
                {f.name.split(" ")[0]}
              </span>
            ))}
            {startup.founders.length > 3 && (
              <span className="text-[10px] font-semibold text-gray-400 px-2 py-1">+{startup.founders.length - 3}</span>
            )}
          </div>
        )}
      </div>
      {/* Footer — website + checkbox */}
      <div className="px-5 py-3 flex items-center justify-between gap-2 relative z-10 border-t border-gray-100">
        {startup.website ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Globe className="w-3 h-3 text-gray-400 flex-none" />
            <span className="text-[10px] text-gray-500 truncate">
              {startup.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </span>
          </div>
        ) : <div />}
        <ScoreBadge startupId={startup.id} />
        <button
          onClick={onToggleSelect}
          className="flex-none p-0.5 rounded text-gray-400 hover:text-[#0F172A] transition-colors"
          aria-label={selected ? "Deselect" : "Select for comparison"}
        >
          {selected
            ? <CheckSquare className="w-4 h-4 text-[#0F172A]" />
            : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />}
        </button>
      </div>
    </div>
  );
}

// ── List Row ──────────────────────────────────────────────────────────────────

function StartupTableRow({ startup, onSelect }: { startup: StartupListRow; onSelect: () => void }) {
  const roundType   = startup.latest_round_type ?? null;
  const roundStyle  = roundType ? (ROUND_STYLE[roundType] ?? ROUND_STYLE["Other"]) : null;
  return (
    <tr onClick={onSelect} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors group">
      <td className="py-3.5 px-5">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black flex-none ${avatarColor(startup.name)}`}>{startup.name[0].toUpperCase()}</div>
          <div>
            <div className="text-sm font-bold text-[#0F172A] leading-tight">{startup.name}</div>
            {startup.industry && <div className="text-[10px] text-gray-400 font-medium">{startup.industry}</div>}
          </div>
        </div>
      </td>
      <td className="py-3.5 px-4">
        {roundType && roundStyle ? <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${roundStyle}`}>{roundType}</span> : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="py-3.5 px-4 text-xs text-gray-500">{[startup.city, startup.country].filter(Boolean).join(", ") || "—"}</td>
      <td className="py-3.5 px-4 text-sm font-bold text-[#0F172A]">{fmt(startup.latest_valuation)}</td>
      <td className="py-3.5 px-4 text-sm font-bold text-[#0F172A]">{fmt(startup.total_raised) || "—"}</td>
      <td className="py-3.5 px-4 text-xs text-gray-500">{fmtEmp(startup.employee_count)}</td>
      <td className="py-3.5 px-4">
        {startup.founders && startup.founders.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {startup.founders.slice(0, 2).map((f, i) => (
              <span key={i} className="text-[10px] bg-gray-50 border border-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{f.name.split(" ")[0]}</span>
            ))}
            {startup.founders.length > 2 && <span className="text-[10px] text-gray-400">+{startup.founders.length - 2}</span>}
          </div>
        ) : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="py-3.5 px-4 text-right text-gray-300 group-hover:text-[#0F172A] transition-colors text-sm">→</td>
    </tr>
  );
}

// ── Add Dialog ────────────────────────────────────────────────────────────────

function AddStartupDialog({ open, onClose, onSuccess }: {
  open: boolean; onClose: () => void; onSuccess: (s: Startup) => void;
}) {
  const [name, setName]       = useState("");
  const [status, setStatus]   = useState<"idle" | "loading" | "error" | "success">("idle");
  const [errorMsg, setError]  = useState("");
  const [progressIdx, setIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setName(""); setStatus("idle"); setError(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);
  useEffect(() => {
    if (status === "loading") {
      timer.current = setInterval(() => setIdx((i) => Math.min(i + 1, PROGRESS_MESSAGES.length - 1)), 3500);
    } else {
      if (timer.current) clearInterval(timer.current);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [status]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setStatus("loading"); setIdx(0); setError("");
    try {
      const { startup } = await ingestStartup(name.trim());
      setStatus("success");
      setTimeout(() => { onSuccess(startup); onClose(); }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={status !== "loading" ? onClose : undefined} />
      <div className="relative bg-white rounded-[24px] shadow-[0_24px_60px_rgba(0,0,0,0.12)] w-full max-w-md p-8 border border-gray-100">
        <button onClick={onClose} disabled={status === "loading"} className="absolute top-5 right-5 text-gray-300 hover:text-gray-600 transition-colors disabled:opacity-30"><X className="w-5 h-5" /></button>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center"><Rocket className="w-5 h-5 text-[#F59E0B]" /></div>
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Add a Startup</h2>
            <p className="text-xs text-gray-400">The agent researches and validates it automatically</p>
          </div>
        </div>
        {status === "success" ? (
          <div className="flex flex-col items-center py-4 gap-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="text-sm font-semibold text-[#0F172A]">Added successfully!</p>
          </div>
        ) : status === "loading" ? (
          <div className="flex flex-col items-center py-6 gap-4 text-center">
            <Loader2 className="w-8 h-8 text-[#F59E0B] animate-spin" />
            <div>
              <p className="text-sm font-semibold text-[#0F172A] mb-1">Researching "{name}"</p>
              <p className="text-xs text-gray-400">{PROGRESS_MESSAGES[progressIdx]}</p>
            </div>
            <div className="flex gap-1 mt-2">
              {PROGRESS_MESSAGES.map((_, i) => (
                <div key={i} className={`h-1 w-6 rounded-full transition-all duration-500 ${i <= progressIdx ? "bg-[#F59E0B]" : "bg-gray-100"}`} />
              ))}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {status === "error" && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 flex-none mt-0.5" /><span>{errorMsg}</span>
              </div>
            )}
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Company name</label>
            <input ref={inputRef} type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Stripe, Wiz, Deel…"
              className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm text-[#0F172A] placeholder-gray-300 focus:outline-none focus:border-[#0F172A]/30 focus:ring-2 focus:ring-[#0F172A]/10 transition-all"
            />
            <p className="text-[11px] text-gray-400 mt-2 mb-5">The agent searches the web, validates the data, and saves — takes ~15 seconds.</p>
            <button type="submit" disabled={!name.trim()} className="w-full rounded-[12px] bg-[#0F172A] hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-300 text-white font-semibold text-sm py-3 transition-all duration-200">
              Research & Add
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Info Tooltip ──────────────────────────────────────────────────────────────
// Hover-triggered dark popover. `align` controls the arrow / box horizontal anchor.

function InfoTooltip({
  content,
  align = "center",
}: {
  content: string;
  align?: "center" | "left" | "right";
}) {
  const boxAlign =
    align === "right" ? "right-0"
    : align === "left" ? "left-0"
    : "left-1/2 -translate-x-1/2";
  const arrowAlign =
    align === "right" ? "right-2.5"
    : align === "left" ? "left-2.5"
    : "left-1/2 -translate-x-1/2";

  return (
    <div className="relative group flex-none">
      {/* Trigger icon */}
      <div className="w-4 h-4 flex items-center justify-center rounded-full bg-[#1a2a3f] hover:bg-[#243858] cursor-help transition-colors">
        <Info className="w-2.5 h-2.5 text-slate-400 group-hover:text-slate-200 transition-colors" />
      </div>
      {/* Popover */}
      <div
        className={`absolute bottom-[calc(100%+10px)] ${boxAlign} w-60 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50`}
      >
        <div className="bg-[#060e1a] border border-[#243858] rounded-[14px] px-3.5 py-3 text-[11px] text-slate-300 shadow-[0_12px_40px_rgba(0,0,0,0.8)] leading-relaxed">
          {content}
        </div>
        {/* Arrow */}
        <div
          className={`absolute top-full ${arrowAlign} w-2.5 h-2.5 bg-[#060e1a] border-r border-b border-[#243858] rotate-45 -mt-[5px]`}
        />
      </div>
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

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

// ── Page ──────────────────────────────────────────────────────────────────────

function headcountRange(step: HeadcountStep): { min?: number; max?: number } {
  switch (step) {
    case "0-50":    return { max: 50 };
    case "51-100":  return { min: 51,  max: 100 };
    case "101-250": return { min: 101, max: 250 };
    case "251-500": return { min: 251, max: 500 };
    case "500+":    return { min: 501 };
    default:        return {};
  }
}

export function Startups() {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Server-side rows for the CURRENT page only — never the full dataset ──
  const [rows, setRows]                 = useState<StartupListRow[]>([]);
  const [rowsLoading, setRowsLoading]   = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [totalCount, setTotalCount]     = useState(0);
  const [countries, setCountries]       = useState<string[]>([]);
  const [refreshKey, setRefreshKey]     = useState(0);

  const [showAdd, setShowAdd]           = useState(false);
  const [search, setSearch]             = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [parentSector, setParentSector] = useState("");
  const [subSector, setSubSector]       = useState("");
  const [countryFilter, setCountry]     = useState("");
  const [stageStep, setStageStep]       = useState<StageStep>("all");
  const [headcountStep, setHeadcount]   = useState<HeadcountStep>("all");
  const [momentumFilter, setMomentum]   = useState(false);
  const [densityFilter, setDensity]     = useState<DensityFilter>("all");
  const [viewMode, setView]             = useState<"grid" | "list">("grid");
  const [tearsheetStartup, setSelected] = useState<StartupListRow | null>(null);
  // Map (not Set) so a selection made on one page survives navigating to
  // another page — Compare needs the full row object, not just an id, since
  // `rows` only ever holds the current page's 40 records.
  const [selected, setSelectedMap]      = useState<Map<string, StartupListRow>>(new Map());
  const [showCompare, setShowCompare]   = useState(false);
  const [page, setPage]                 = useState(1);

  const cityParam = searchParams.get("city") ?? "";
  const [cityFilter, setCityFilter] = useState(cityParam);

  function toggleSelect(row: StartupListRow, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) { next.delete(row.id); }
      else if (next.size < 3) { next.set(row.id, row); }
      return next;
    });
  }
  function addPeer(peer: StartupListRow) {
    setSelectedMap((prev) => {
      if (prev.size >= 3 || prev.has(peer.id)) return prev;
      const next = new Map(prev);
      next.set(peer.id, peer);
      return next;
    });
  }

  // Debounce free-text search 300ms so filters don't refire on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    fetchDistinctCountries().then(setCountries).catch(() => {});
  }, []);

  function clearCityFilter() {
    setCityFilter("");
    setSearchParams((p) => { p.delete("city"); return p; });
  }
  function clearAll() {
    setSearch(""); setParentSector(""); setSubSector(""); setCountry("");
    setStageStep("all"); setHeadcount("all"); setMomentum(false); setDensity("all");
    clearCityFilter();
  }

  const activeFilterCount = [
    search, parentSector, subSector, countryFilter, cityFilter,
    stageStep !== "all" ? "1" : "",
    headcountStep !== "all" ? "1" : "",
    momentumFilter ? "1" : "",
    densityFilter !== "all" ? "1" : "",
  ].filter(Boolean).length;

  // Everything the sidebar controls collapses into one filters object, which
  // is what actually drives the Supabase query — no in-memory dataset to
  // filter against exists anymore.
  const filters: StartupSearchFilters = useMemo(() => {
    const f: StartupSearchFilters = {};
    if (debouncedSearch) f.search = debouncedSearch;
    if (parentSector) f.sectorParent = parentSector;
    if (parentSector && subSector) f.sectorSubKeywords = keywordsForSub(parentSector, subSector);
    if (countryFilter) f.country = countryFilter;
    if (cityFilter) f.city = cityFilter;
    if (stageStep !== "all") {
      const step = STAGE_STEPS.find((st) => st.value === stageStep);
      if (step && step.rounds.length > 0) f.stageRoundTypes = step.rounds;
    }
    if (headcountStep !== "all") {
      const { min, max } = headcountRange(headcountStep);
      if (min != null) f.headcountMin = min;
      if (max != null) f.headcountMax = max;
    }
    if (momentumFilter) f.momentum = true;
    if (densityFilter !== "all") f.density = densityFilter;
    return f;
  }, [debouncedSearch, parentSector, subSector, countryFilter, cityFilter, stageStep, headcountStep, momentumFilter, densityFilter]);

  // Any filter change starts the user back on page 1.
  useEffect(() => { setPage(1); }, [filters]);

  useEffect(() => {
    let cancelled = false;
    setRowsLoading(true); setLoadError(null);
    fetchStartupsPage(filters, page)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "Unknown error"); })
      .finally(() => { if (!cancelled) setRowsLoading(false); });
    return () => { cancelled = true; };
  }, [filters, page, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    fetchStartupsCount(filters)
      .then((c) => { if (!cancelled) setTotalCount(c); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filters, refreshKey]);

  const selectedStartups = useMemo(() => Array.from(selected.values()), [selected]);

  const pageCount = Math.max(1, Math.ceil(totalCount / STARTUPS_PAGE_SIZE));

  const currentStageLabel = STAGE_STEPS.find((s) => s.value === stageStep)?.label ?? "All";
  const currentHeadcountLabel = HEADCOUNT_STEPS.find((s) => s.value === headcountStep)?.label ?? "All";

  return (
    <Layout>

      {/* ── Title bar ────────────────────────────────────────────────────── */}
      <div style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 pt-6 pb-5">
          <div className="flex items-center justify-between gap-4 mb-1.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
              Startups Hub
              {cityFilter && <span className="ml-3 text-lg font-medium text-[#0F172A]">in {cityFilter}</span>}
            </h1>
            <div className="flex items-center gap-2 flex-none">
              <div className="flex items-center bg-white/60 border border-black/10 rounded-[12px] p-1">
                <button onClick={() => setView("grid")} className={`p-1.5 rounded-[8px] transition-all ${viewMode === "grid" ? "bg-white text-[#0F172A] shadow-sm" : "text-[#0F172A]/50 hover:text-[#0F172A]"}`}><LayoutGrid className="w-4 h-4" /></button>
                <button onClick={() => setView("list")} className={`p-1.5 rounded-[8px] transition-all ${viewMode === "list" ? "bg-white text-[#0F172A] shadow-sm" : "text-[#0F172A]/50 hover:text-[#0F172A]"}`}><List className="w-4 h-4" /></button>
              </div>
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 rounded-[14px] bg-[#0F172A] px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_14px_rgba(15,23,42,0.25)] hover:bg-[#1e293b] transition-all">
                <Plus className="w-4 h-4" />Add Startup
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-sm text-[#0F172A]/60 leading-snug">
              Research private tech companies with AI and other advanced tools
            </p>
            <span className="text-xs font-semibold text-[#0F172A]/60 bg-white/60 border border-black/10 px-2.5 py-1 rounded-full flex-none">
              {totalCount.toLocaleString()} {totalCount === 1 ? "company" : "companies"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Sidebar + main content (shared SideFilterLayout shell) ───────── */}
      <SideFilterLayout
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search companies…"
        activeFilterCount={activeFilterCount}
        onClearAll={clearAll}
        extraBottomPadding={selected.size >= 1}
        filters={
          <>
              <FilterAccordion title="Sectors" defaultOpen
                badge={parentSector ? <FilterBadge>{subSector || parentSector}</FilterBadge> : undefined}>
                <HierarchicalSectorFilter
                  parentSector={parentSector} onParentChange={setParentSector}
                  subSector={subSector}       onSubChange={setSubSector}
                />
              </FilterAccordion>

              <FilterAccordion title="Countries" defaultOpen={false}
                badge={countryFilter ? <FilterBadge>{countryFilter}</FilterBadge> : undefined}>
                <CountryFilterList countries={countries} value={countryFilter} onChange={setCountry} />
              </FilterAccordion>

              <FilterAccordion title="Funding Stage" defaultOpen
                badge={stageStep !== "all" ? <FilterBadge>{currentStageLabel}</FilterBadge> : undefined}>
                <StepSlider steps={STAGE_STEPS} value={stageStep} onChange={(v) => setStageStep(v as StageStep)} />
              </FilterAccordion>

              <FilterAccordion title="Headcount" defaultOpen
                badge={headcountStep !== "all" ? <FilterBadge>{currentHeadcountLabel}</FilterBadge> : undefined}>
                <StepSlider steps={HEADCOUNT_STEPS} value={headcountStep} onChange={(v) => setHeadcount(v as HeadcountStep)} />
              </FilterAccordion>

              <FilterAccordion title="Financial Momentum" defaultOpen={false}
                badge={momentumFilter ? <FilterBadge>On</FilterBadge> : undefined}>
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => setMomentum((v) => !v)}
                    className={`flex-1 flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-xs font-semibold border transition-all ${
                      momentumFilter
                        ? "bg-emerald-50 border-emerald-400/60 text-emerald-700"
                        : "bg-gray-50 border-gray-100 text-gray-500 hover:border-gray-300 hover:text-[#0F172A]"
                    }`}
                  >
                    <Zap className={`w-3.5 h-3.5 flex-none ${momentumFilter ? "text-emerald-600" : "text-gray-400"}`} />
                    Raised + growing (6mo)
                    {momentumFilter && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-none ml-auto" />}
                  </button>
                  <InfoTooltip content="Filters for companies that raised capital in the last 6 months AND achieved ≥20% headcount growth (via trend tracking)." align="right" />
                </div>
              </FilterAccordion>

              <FilterAccordion title="Competitive Density" defaultOpen={false}
                badge={densityFilter !== "all" ? <FilterBadge>{densityFilter === "crowded" ? "Crowded" : "Blue Ocean"}</FilterBadge> : undefined}>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 flex items-center bg-gray-50 border border-gray-100 rounded-[10px] p-0.5 gap-0.5">
                    {([ ["all", "All"], ["crowded", "Crowded"], ["blue-ocean", "Blue Ocean"] ] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setDensity(val)}
                        className={`flex-1 px-2 py-1.5 rounded-[7px] text-[10px] font-semibold transition-all whitespace-nowrap ${
                          densityFilter === val
                            ? "bg-[#0F172A] text-white shadow-sm"
                            : "text-gray-500 hover:text-[#0F172A]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <InfoTooltip content="Categorizes market space by peer density: 'Crowded' identifies companies with several peers in the same sector and funding stage. 'Blue Ocean' identifies highly differentiated companies with few or no peers." align="right" />
                </div>
              </FilterAccordion>

              {cityFilter && (
                <div className="py-4">
                  <button onClick={clearCityFilter} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-[#0F172A] text-white hover:bg-[#1e293b] transition-all">
                    <MapPin className="w-3 h-3" />{cityFilter}<X className="w-3 h-3 ml-0.5" />
                  </button>
                </div>
              )}
          </>
        }
      >
            {loadError && rows.length === 0 ? (
              <div className="flex flex-col items-center py-24 gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm font-semibold text-[#0F172A]">Failed to load startups</p>
                <p className="text-xs text-gray-400 max-w-xs">{loadError}</p>
              </div>
            ) : rowsLoading && rows.length === 0 ? (
              <div className="flex items-center justify-center py-32"><Loader2 className="w-6 h-6 text-[#F59E0B] animate-spin" /></div>
            ) : rows.length === 0 && activeFilterCount === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 text-center">
                <div className="w-16 h-16 rounded-3xl bg-amber-50 flex items-center justify-center mb-6"><Rocket className="w-7 h-7 text-[#F59E0B]" /></div>
                <h2 className="text-xl font-bold text-[#0F172A] mb-3">No startups yet</h2>
                <p className="text-sm text-gray-400 max-w-sm leading-relaxed mb-8">
                  Add your first startup — the AI agent will research, validate, and store it with full funding history.
                </p>
                <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-[16px] bg-[#0F172A] px-6 py-3 text-sm font-bold text-white shadow-[0_4px_14px_rgba(15,23,42,0.25)] hover:bg-[#1e293b] transition-all">
                  <Plus className="w-4 h-4" />Add First Startup
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center py-20 gap-3 text-center">
                <Building2 className="w-8 h-8 text-gray-300" />
                <p className="text-sm font-semibold text-gray-400">No companies match these filters</p>
                <button onClick={clearAll} className="text-xs text-gray-500 font-semibold hover:text-rose-600 transition-colors">Clear all filters</button>
              </div>
            ) : (
              <div className="relative">
                {rowsLoading && (
                  <div className="absolute inset-0 z-10 flex items-start justify-center pt-16 bg-white/50 backdrop-blur-[1px] rounded-[20px] transition-opacity">
                    <Loader2 className="w-5 h-5 text-[#F59E0B] animate-spin" />
                  </div>
                )}
                {viewMode === "grid" ? (
                  <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 transition-opacity duration-150 ${rowsLoading ? "opacity-40" : "opacity-100"}`}>
                    {rows.map((s) => (
                      <StartupCard key={s.id} startup={s} onSelect={() => setSelected(s)}
                        selected={selected.has(s.id)} onToggleSelect={(e) => toggleSelect(s, e)} />
                    ))}
                  </div>
                ) : (
                  <div className={`bg-white rounded-[20px] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden transition-opacity duration-150 ${rowsLoading ? "opacity-40" : "opacity-100"}`}>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-100 bg-[#F8FAFC]">
                            {["Company", "Stage", "Location", "Valuation", "Raised", "Employees", "Founders", ""].map((h) => (
                              <th key={h} className="text-left text-[9px] font-black text-gray-400 uppercase tracking-widest py-3 px-4 first:px-5 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((s) => <StartupTableRow key={s.id} startup={s} onSelect={() => setSelected(s)} />)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <Pagination page={page} pageCount={pageCount} onChange={setPage} />
              </div>
            )}
      </SideFilterLayout>

      <AddStartupDialog open={showAdd} onClose={() => setShowAdd(false)}
        onSuccess={() => { setPage(1); setRefreshKey((k) => k + 1); }} />

      {tearsheetStartup && (
        <TearsheetModal startup={tearsheetStartup} onClose={() => setSelected(null)} onNavigate={(row) => setSelected(row)} />
      )}

      {showCompare && selectedStartups.length >= 2 && (
        <CompareModal startups={selectedStartups}
          onClose={() => setShowCompare(false)} onAddPeer={addPeer} />
      )}

      {/* ── Floating Compare FAB ────────────────────────────────────────── */}
      {selected.size >= 1 && (
        <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2">
          {/* Clear selection */}
          <button
            onClick={() => setSelectedMap(new Map())}
            title="Clear selection"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-[#0b1626]/90 backdrop-blur-sm border border-[#1a2a3f] text-slate-500 hover:text-white hover:border-slate-500 transition-all shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          {/* Compare button */}
          <button
            onClick={() => { if (selected.size >= 2) setShowCompare(true); }}
            className={`flex items-center gap-2.5 px-5 py-3.5 rounded-[20px] text-sm font-bold transition-all duration-200 ${
              selected.size >= 2
                ? "bg-blue-600 text-white shadow-[0_8px_40px_rgba(37,99,235,0.45)] hover:bg-blue-500 hover:shadow-[0_12px_48px_rgba(37,99,235,0.5)] hover:scale-[1.02]"
                : "bg-[#0b1626]/90 backdrop-blur-sm border border-[#1a2a3f] text-slate-400 shadow-[0_4px_24px_rgba(0,0,0,0.45)] cursor-default"
            }`}
          >
            <GitCompare className="w-4 h-4 flex-none" />
            {selected.size >= 2
              ? `Compare (${selected.size})`
              : `Select ${2 - selected.size} more…`}
          </button>
        </div>
      )}

    </Layout>
  );
}
