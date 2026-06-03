import React, { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { Layout } from "../components/Layout";
import {
  Plus, Globe, Loader2, Search, X, MapPin, Calendar, Users,
  DollarSign, Rocket, AlertCircle, CheckCircle2,
  TrendingUp, TrendingDown, Minus,
  UserRound, LayoutGrid, List, ExternalLink,
  ChevronDown, Building2, CheckSquare, Square,
  GitCompare, Clock, Briefcase,
} from "lucide-react";
import {
  fetchStartups, ingestStartup,
  type Startup, type FundingRound, type RoundType,
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
  "Other":            "bg-gray-50 text-gray-500 border border-gray-100",
};
const ROUND_HEX: Record<string, string> = {
  "Pre-Seed": "#7C3AED", "Seed": "#2563EB", "Series A": "#059669",
  "Series B": "#D97706", "Series C": "#EA580C", "Series D": "#C2410C",
  "Series E+": "#DC2626", "Growth": "#4338CA", "Bridge": "#0284C7",
  "Convertible Note": "#0891B2", "Bootstrapped": "#0D9488",
  "Grant": "#65A30D", "Acquired": "#6B7280", "Other": "#9CA3AF",
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

// ── Country / Region helpers ──────────────────────────────────────────────────

const COUNTRY_REGION: Record<string, string> = {
  "Israel": "Middle East",
  "UAE": "Middle East", "United Arab Emirates": "Middle East",
  "Saudi Arabia": "Middle East", "Jordan": "Middle East", "Egypt": "Middle East",
  "United States": "North America", "USA": "North America", "US": "North America",
  "Canada": "North America",
  "United Kingdom": "Europe", "UK": "Europe", "England": "Europe",
  "Germany": "Europe", "France": "Europe", "Netherlands": "Europe",
  "Sweden": "Europe", "Switzerland": "Europe", "Estonia": "Europe",
  "Spain": "Europe", "Italy": "Europe", "Poland": "Europe",
  "India": "Asia", "Singapore": "Asia", "China": "Asia",
  "Japan": "Asia", "South Korea": "Asia", "Hong Kong": "Asia",
  "Australia": "Oceania", "New Zealand": "Oceania",
  "Brazil": "Latin America", "Mexico": "Latin America", "Colombia": "Latin America",
};

function getRegion(country: string | null): string {
  if (!country) return "unknown";
  return COUNTRY_REGION[country] ?? "other";
}

// ── Stage helpers ─────────────────────────────────────────────────────────────

type StageGroup = "early" | "growth" | "late" | "unknown";
const STAGE_GROUP_ORDER: StageGroup[] = ["early", "growth", "late"];

function getStageGroup(rt: RoundType | null | undefined): StageGroup {
  if (!rt || rt === "Other" || rt === "Bootstrapped" || rt === "Grant") return "unknown";
  if (["Pre-Seed", "Seed", "Convertible Note", "Bridge"].includes(rt)) return "early";
  if (["Series A", "Series B"].includes(rt)) return "growth";
  return "late";
}

function isAdjacentStage(a: StageGroup, b: StageGroup): boolean {
  if (a === "unknown" || b === "unknown") return false;
  return Math.abs(STAGE_GROUP_ORDER.indexOf(a) - STAGE_GROUP_ORDER.indexOf(b)) === 1;
}

// ── Weighted peer scoring (Industry 50 / Stage 30 / Geo 20) ──────────────────

const PEER_THRESHOLD = 75;

function scorePeer(target: Startup, candidate: Startup): number {
  let score = 0;

  // Industry (50 pts)
  const tt = classifyIndustry(target.industry);
  const ct = classifyIndustry(candidate.industry);
  if (tt.parent !== "Uncategorized" && ct.parent !== "Uncategorized") {
    if (tt.sub === ct.sub)         score += 50;
    else if (tt.parent === ct.parent) score += 30;
  }

  // Stage (30 pts)
  const ts = getStageGroup(target.funding_rounds?.[0]?.round_type);
  const cs = getStageGroup(candidate.funding_rounds?.[0]?.round_type);
  if (ts !== "unknown" && cs !== "unknown") {
    if (ts === cs)                 score += 30;
    else if (isAdjacentStage(ts, cs)) score += 15;
  }

  // Geography (20 pts)
  if (target.country && candidate.country) {
    if (target.country === candidate.country) score += 20;
    else if (getRegion(target.country) === getRegion(candidate.country) &&
             getRegion(target.country) !== "other") score += 8;
  }

  return score;
}

function findPeerGroup(target: Startup, pool: Startup[]): Array<{ startup: Startup; score: number }> {
  return pool
    .filter((s) => s.id !== target.id)
    .map((s) => ({ startup: s, score: scorePeer(target, s) }))
    .filter((x) => x.score >= PEER_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function totalRaised(s: Startup): number {
  return (s.funding_rounds ?? []).reduce((sum, r) => sum + (r.amount_raised ?? 0), 0);
}

// ── Step Slider ───────────────────────────────────────────────────────────────

function StepSlider({
  steps, value, onChange,
}: {
  steps: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const idx = Math.max(0, steps.findIndex((s) => s.value === value));
  const pct = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 0;

  return (
    <div>
      <div className="relative h-4 flex items-center mx-1">
        {/* Background track */}
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-gray-200" />
        {/* Filled track */}
        <div
          className="absolute left-0 h-[3px] rounded-full bg-[#F59E0B] transition-all duration-100"
          style={{ width: `${pct}%` }}
        />
        {/* Stop dots */}
        {steps.map((_, i) => (
          <div
            key={i}
            className={`absolute w-2.5 h-2.5 rounded-full border-[2px] -translate-x-1/2 transition-all duration-100 ${
              i < idx  ? "bg-[#F59E0B] border-[#F59E0B]"  :
              i === idx ? "bg-white border-[#F59E0B] scale-125" :
                          "bg-white border-gray-300"
            }`}
            style={{ left: `${steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0}%` }}
          />
        ))}
        {/* Invisible native range for drag + keyboard */}
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={idx}
          onChange={(e) => onChange(steps[Number(e.target.value)].value)}
          className="absolute inset-x-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
      </div>
      {/* Tick labels */}
      <div className="flex justify-between mt-2 px-0.5">
        {steps.map((s, i) => (
          <button
            key={s.value}
            onClick={() => onChange(s.value)}
            className={`text-[9px] font-semibold leading-none transition-colors ${
              i === idx ? "text-[#F59E0B]" : "text-gray-400 hover:text-gray-600"
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

// ── Slider step definitions ───────────────────────────────────────────────────

const STAGE_STEPS = [
  { value: "all",       label: "All",        rounds: [] as RoundType[] },
  { value: "pre-seed",  label: "Pre-Seed",   rounds: ["Pre-Seed", "Convertible Note"] as RoundType[] },
  { value: "seed",      label: "Seed",       rounds: ["Seed", "Bridge"] as RoundType[] },
  { value: "series-a",  label: "Series A",   rounds: ["Series A"] as RoundType[] },
  { value: "series-b",  label: "Series B",   rounds: ["Series B"] as RoundType[] },
  { value: "growth",    label: "Growth/Late", rounds: ["Series C", "Series D", "Series E+", "Growth", "Acquired"] as RoundType[] },
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

const TIMEFRAME_OPTIONS = [
  { label: "All time",    value: "all" },
  { label: "Last 12 mo", value: "12m" },
  { label: "Last 18 mo", value: "18m" },
  { label: "Last 3 yrs", value: "36m" },
] as const;
type Timeframe = (typeof TIMEFRAME_OPTIONS)[number]["value"];

const PROGRESS_MESSAGES = [
  "Searching the web for funding data…",
  "Analyzing founding team & leadership…",
  "Identifying headquarters location…",
  "Scanning job boards for hiring signals…",
  "Validating entry conditions…",
  "Saving to AlphaMap…",
];

// ── Hierarchical Sector Filter ────────────────────────────────────────────────

function HierarchicalSectorFilter({
  parentSector, onParentChange,
  subSector,    onSubChange,
}: {
  parentSector: string; onParentChange: (v: string) => void;
  subSector:    string; onSubChange:    (v: string) => void;
}) {
  const parents = Object.keys(SECTOR_TAXONOMY).filter((p) => p !== "Uncategorized");
  const subs    = parentSector ? (SECTOR_TAXONOMY[parentSector] ?? []) : [];

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative">
        <select
          value={parentSector}
          onChange={(e) => { onParentChange(e.target.value); onSubChange(""); }}
          className={`appearance-none pl-3 pr-8 py-2 text-xs font-semibold border rounded-[10px] bg-white transition-all focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/20 cursor-pointer ${
            parentSector ? "border-[#F59E0B] text-[#0F172A]" : "border-gray-200 text-gray-500"
          }`}
        >
          <option value="">All Sectors</option>
          {parents.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="Uncategorized">Uncategorized</option>
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
      </div>
      {parentSector && subs.length > 0 && (
        <div className="relative">
          <select
            value={subSector}
            onChange={(e) => onSubChange(e.target.value)}
            className={`appearance-none pl-3 pr-8 py-2 text-xs font-semibold border rounded-[10px] bg-white transition-all focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/20 cursor-pointer ${
              subSector ? "border-[#F59E0B] text-[#0F172A]" : "border-gray-200 text-gray-500"
            }`}
          >
            <option value="">All {parentSector}</option>
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      )}
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
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Funding Timeline</h4>
        <span className="text-[9px] text-slate-600 ml-auto">Cumulative raised</span>
      </div>
      <div className="bg-[#091422] rounded-[16px] p-4 border border-[#1a2a3f]">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="fundGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#F59E0B" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a2a3f" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: "#64748b", fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={tickFmt} tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} width={56} domain={[0, domainMax]} />
            <ReTooltip content={<TimelineTooltip />} cursor={{ stroke: "#F59E0B", strokeWidth: 1, strokeDasharray: "4 2" }} />
            <Area
              type="monotone" dataKey="cumulative"
              stroke="#F59E0B" strokeWidth={2} fill="url(#fundGrad)"
              dot={(props: { cx: number; cy: number; payload: TimelinePoint }) => (
                <circle key={props.payload.date} cx={props.cx} cy={props.cy} r={5}
                  fill={props.payload.color} stroke="#0b1626" strokeWidth={2} />
              )}
              activeDot={{ r: 7, fill: "#F59E0B", stroke: "#0b1626", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Growth Trend Badge ────────────────────────────────────────────────────────

function GrowthTrendBadge({ trend }: { trend: string | null | undefined }) {
  if (!trend || trend === "unknown") return null;
  const cfg: Record<string, { Icon: React.ComponentType<{ className?: string }>; label: string; cls: string }> = {
    "rapid growth":    { Icon: TrendingUp,   label: "Rapid Growth",    cls: "bg-emerald-900/40 text-emerald-400 border-emerald-800/60" },
    "moderate growth": { Icon: TrendingUp,   label: "Moderate Growth", cls: "bg-blue-900/40 text-blue-400 border-blue-800/60" },
    "stable":          { Icon: Minus,        label: "Stable",          cls: "bg-slate-700/60 text-slate-300 border-slate-600/60" },
    "reduction":       { Icon: TrendingDown, label: "Reduction",       cls: "bg-red-900/40 text-red-400 border-red-800/60" },
  };
  const c = cfg[trend];
  if (!c) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border ${c.cls}`}>
      <c.Icon className="w-3 h-3" />{c.label}
    </span>
  );
}

// ── Tearsheet Modal ───────────────────────────────────────────────────────────

function TearsheetModal({
  startup, allStartups, onClose, onNavigate,
}: {
  startup: Startup; allStartups: Startup[];
  onClose: () => void; onNavigate: (s: Startup) => void;
}) {
  const latestRound = startup.funding_rounds?.[0] ?? null;
  const roundType   = latestRound?.round_type ?? null;
  const roundStyle  = roundType ? (ROUND_STYLE[roundType] ?? ROUND_STYLE["Other"]) : null;
  const location    = [startup.city, startup.country].filter(Boolean).join(", ") || null;

  const sortedRounds = useMemo(
    () => [...(startup.funding_rounds ?? [])].sort(
      (a, b) => (a.announcement_date ?? "").localeCompare(b.announcement_date ?? ""),
    ),
    [startup.funding_rounds],
  );

  const peers = useMemo(() => findPeerGroup(startup, allStartups), [startup, allStartups]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0b1626] rounded-[24px] shadow-[0_32px_80px_rgba(0,0,0,0.7)] w-full max-w-2xl max-h-[92vh] overflow-y-auto border border-[#1a2a3f]">

        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-[#060e1a] rounded-t-[24px] px-7 py-5 border-b border-[#1a2a3f]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black flex-none ${avatarColor(startup.name)}`}>
                {startup.name[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-white leading-tight truncate">{startup.name}</h2>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {startup.industry && <span className="text-xs text-slate-400 font-medium">{startup.industry}</span>}
                  {location && (
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <MapPin className="w-3 h-3" />{location}
                    </span>
                  )}
                  {startup.founded_year && (
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Calendar className="w-3 h-3" />est. {startup.founded_year}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-none">
              {roundType && roundStyle && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${roundStyle}`}>{roundType}</span>
              )}
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors">
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-7 space-y-7">
          {startup.description && (
            <p className="text-sm text-slate-300 leading-relaxed">{startup.description}</p>
          )}

          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: DollarSign, label: "Total Raised", value: fmt(totalRaised(startup)) },
              { icon: TrendingUp, label: "Valuation",    value: fmt(latestRound?.valuation) },
              { icon: Users,      label: "Employees",    value: fmtEmp(startup.employee_count) },
              { icon: Calendar,   label: "Founded",      value: startup.founded_year ? String(startup.founded_year) : "—" },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-[#091422] rounded-[14px] p-4 flex flex-col gap-2 border border-[#1a2a3f]">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
                </div>
                <span className="text-sm font-bold text-white">{value}</span>
              </div>
            ))}
          </div>

          {/* Funding timeline */}
          {sortedRounds.length >= 2 && <FundingTimeline rounds={sortedRounds} />}

          {/* Funding rounds list */}
          {sortedRounds.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-slate-500" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Funding Rounds</h3>
              </div>
              <div className="flex flex-col gap-2">
                {sortedRounds.map((r, idx) => (
                  <div key={r.id ?? idx} className="flex items-start justify-between gap-4 bg-[#091422] border border-[#1a2a3f] rounded-[14px] p-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full flex-none mt-1"
                        style={{ backgroundColor: ROUND_HEX[r.round_type ?? "Other"] ?? "#9CA3AF" }} />
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.round_type && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROUND_STYLE[r.round_type] ?? ROUND_STYLE["Other"]}`}>
                              {r.round_type}
                            </span>
                          )}
                          {r.announcement_date && (
                            <span className="text-xs text-slate-500">
                              {new Date(r.announcement_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {r.amount_raised && (
                            <span className="text-xs text-slate-400">
                              <span className="font-bold text-white">{fmt(r.amount_raised)}</span> raised
                            </span>
                          )}
                          {r.valuation && (
                            <span className="text-xs text-slate-400">
                              <span className="font-bold text-white">{fmt(r.valuation)}</span>
                              {r.is_valuation_estimated && <span className="text-slate-500"> est.</span>} val.
                            </span>
                          )}
                        </div>
                        {r.lead_investor && (
                          <span className="text-[10px] text-slate-500">
                            Lead: <span className="text-slate-300 font-medium">{r.lead_investor}</span>
                            {r.investors && r.investors.length > 1 && (
                              <span className="text-slate-600"> +{r.investors.length - 1} more</span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    {r.source_url && (
                      <a href={r.source_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-[#F59E0B] hover:underline font-medium flex-none">
                        Source <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Headcount */}
          {(startup.employee_count || startup.growth_trend) && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-slate-500" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Headcount</h3>
              </div>
              <div className="bg-[#091422] border border-[#1a2a3f] rounded-[14px] p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-2xl font-black text-white leading-none">
                    {startup.employee_count ? fmtEmp(startup.employee_count) : "—"}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">employees (estimated)</div>
                </div>
                <GrowthTrendBadge trend={startup.growth_trend} />
              </div>
            </div>
          )}

          {/* Leadership */}
          {startup.leadership && startup.leadership.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="w-4 h-4 text-slate-500" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Leadership</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {startup.leadership.map((l, i) => (
                  <div key={i} className="flex items-center gap-2.5 bg-[#091422] border border-[#1a2a3f] rounded-[12px] px-3 py-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-none ${avatarColor(l.name)}`}>
                      {l.name[0]}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white leading-tight">{l.name}</div>
                      <div className="text-[9px] text-slate-500">{l.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Founders */}
          {startup.founders && startup.founders.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <UserRound className="w-4 h-4 text-slate-500" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Founder{startup.founders.length > 1 ? "s" : ""}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {startup.founders.map((f, i) => (
                  <span key={i} className="flex items-center gap-1.5 bg-[#091422] border border-[#1a2a3f] text-sm font-medium text-slate-200 px-3 py-1.5 rounded-full">
                    <div className="w-5 h-5 rounded-full bg-amber-900/60 flex items-center justify-center text-[10px] font-black text-amber-400">
                      {f[0].toUpperCase()}
                    </div>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Similar Companies — always render, show explicit empty state */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-4 h-4 text-slate-500" />
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Similar Companies</h3>
              <span className="ml-1 text-[9px] text-slate-600 bg-[#0a1830] border border-[#1a2a3f] px-2 py-0.5 rounded-full">
                ≥ {PEER_THRESHOLD}% match
              </span>
            </div>
            {peers.length === 0 ? (
              <div className="flex items-center gap-2 bg-[#091422] border border-[#1a2a3f] rounded-[12px] px-4 py-3">
                <Building2 className="w-3.5 h-3.5 text-slate-600 flex-none" />
                <p className="text-xs text-slate-600 italic">
                  No close peers found — no companies met the {PEER_THRESHOLD}% similarity threshold.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {peers.map(({ startup: peer, score }) => {
                  const pr = peer.funding_rounds?.[0];
                  return (
                    <button
                      key={peer.id}
                      onClick={() => onNavigate(peer)}
                      className="flex items-center gap-3 bg-[#091422] border border-[#1a2a3f] hover:border-[#243858] rounded-[14px] px-4 py-3 text-left transition-colors group"
                    >
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black flex-none ${avatarColor(peer.name)}`}>
                        {peer.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-white group-hover:text-[#F59E0B] transition-colors truncate">{peer.name}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {[peer.industry, [peer.city, peer.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-none">
                        <span className="text-[9px] font-bold text-slate-600 bg-[#0a1830] border border-[#1a2a3f] px-1.5 py-0.5 rounded-full">
                          {score}%
                        </span>
                        {pr?.round_type && (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROUND_STYLE[pr.round_type] ?? ROUND_STYLE["Other"]}`}>
                            {pr.round_type}
                          </span>
                        )}
                        <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {startup.website && (
            <a href={startup.website} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-[#F59E0B] transition-colors">
              <Globe className="w-4 h-4" />
              {startup.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <ExternalLink className="w-3.5 h-3.5 opacity-40" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Comparison Modal ──────────────────────────────────────────────────────────

function CompareModal({
  startups, allStartups, onClose, onAddPeer,
}: {
  startups: Startup[]; allStartups: Startup[];
  onClose: () => void; onAddPeer: (s: Startup) => void;
}) {
  const peers = useMemo(
    () =>
      findPeerGroup(startups[0], allStartups)
        .filter(({ startup: p }) => !startups.some((s) => s.id === p.id))
        .slice(0, 3),
    [startups, allStartups],
  );

  const chartData = startups.map((s) => ({
    name:  s.name.length > 10 ? s.name.slice(0, 9) + "…" : s.name,
    total: totalRaised(s) / 1e6,
    color: ROUND_HEX[s.funding_rounds?.[0]?.round_type ?? "Other"] ?? "#9CA3AF",
  }));

  const rows: Array<{ label: string; values: React.ReactNode[] }> = [
    { label: "Stage",       values: startups.map((s) => { const rt = s.funding_rounds?.[0]?.round_type; return rt ? <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROUND_STYLE[rt] ?? ROUND_STYLE["Other"]}`}>{rt}</span> : <span className="text-slate-600">—</span>; }) },
    { label: "Total Raised",values: startups.map((s) => { const t = totalRaised(s); return <span className="font-bold text-white">{t ? fmt(t) : "—"}</span>; }) },
    { label: "Valuation",   values: startups.map((s) => <span className="font-bold text-white">{fmt(s.funding_rounds?.[0]?.valuation)}</span>) },
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
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base font-black ${avatarColor(s.name)}`}>{s.name[0].toUpperCase()}</div>
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
          {peers.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Suggested Peers <span className="text-slate-600 font-medium normal-case">· ≥ {PEER_THRESHOLD}% match</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {peers.map(({ startup: peer, score }) => (
                  <button key={peer.id} onClick={() => onAddPeer(peer)} disabled={startups.length >= 3}
                    className="flex items-center gap-2 bg-[#091422] border border-[#1a2a3f] hover:border-[#243858] disabled:opacity-40 disabled:cursor-not-allowed rounded-[12px] px-3 py-2 transition-colors">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black flex-none ${avatarColor(peer.name)}`}>{peer.name[0]}</div>
                    <div className="text-left">
                      <div className="text-xs font-bold text-white">{peer.name}</div>
                      <div className="text-[9px] text-slate-500">{peer.industry}</div>
                    </div>
                    <span className="text-[9px] text-slate-600 font-bold ml-1">{score}%</span>
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
  startup: Startup; onSelect: () => void;
  selected: boolean; onToggleSelect: (e: React.MouseEvent) => void;
}) {
  const latestRound = startup.funding_rounds?.[0] ?? null;
  const roundType   = latestRound?.round_type ?? null;
  const roundStyle  = roundType ? (ROUND_STYLE[roundType] ?? ROUND_STYLE["Other"]) : null;
  const location    = [startup.city, startup.country].filter(Boolean).join(", ") || null;

  return (
    <div
      onClick={onSelect}
      className={`relative bg-[#0b1626] rounded-[20px] border shadow-[0_2px_16px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col overflow-hidden cursor-pointer group ${
        selected ? "border-[#F59E0B]" : "border-[#1a2a3f] hover:border-[#243858]"
      }`}
    >
      <div className="p-5 pb-4 flex-1">
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base font-black flex-none ${avatarColor(startup.name)}`}>
            {startup.name[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-bold text-white truncate leading-tight group-hover:text-[#F59E0B] transition-colors">
              {startup.name}
            </h3>
            {startup.industry && (
              <span className="text-xs text-slate-400 font-medium">{startup.industry}</span>
            )}
          </div>
          {roundType && roundStyle && (
            <span className={`flex-none text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${roundStyle}`}>{roundType}</span>
          )}
        </div>
        {startup.description && (
          <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 mb-4">{startup.description}</p>
        )}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-[#091422] rounded-[10px] px-3 py-2">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Valuation</div>
            <div className="text-sm font-bold text-white">{fmt(latestRound?.valuation)}</div>
          </div>
          <div className="bg-[#091422] rounded-[10px] px-3 py-2">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Raised</div>
            <div className="text-sm font-bold text-white">{fmt(totalRaised(startup)) || "—"}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 mb-3">
          {location    && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{location}</span>}
          {startup.employee_count && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{fmtEmp(startup.employee_count)} emp</span>}
          {startup.founded_year   && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{startup.founded_year}</span>}
        </div>
        {startup.founders && startup.founders.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {startup.founders.slice(0, 3).map((f, i) => (
              <span key={i} className="flex items-center gap-1 bg-[#091422] border border-[#1a2a3f] text-[10px] font-semibold text-slate-300 px-2 py-1 rounded-full">
                <div className="w-3.5 h-3.5 rounded-full bg-amber-900/60 flex items-center justify-center text-[8px] font-black text-amber-400">
                  {f[0].toUpperCase()}
                </div>
                {f.split(" ")[0]}
              </span>
            ))}
            {startup.founders.length > 3 && (
              <span className="text-[10px] font-semibold text-slate-500 px-2 py-1">+{startup.founders.length - 3}</span>
            )}
          </div>
        )}
      </div>
      {/* Footer — website + checkbox */}
      <div className="px-5 py-3 border-t border-[#1a2a3f] flex items-center justify-between gap-2">
        {startup.website ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Globe className="w-3 h-3 text-slate-600 flex-none" />
            <span className="text-[10px] text-slate-500 truncate">
              {startup.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </span>
          </div>
        ) : <div />}
        <button
          onClick={onToggleSelect}
          className="flex-none p-0.5 rounded text-slate-500 hover:text-[#F59E0B] transition-colors"
          aria-label={selected ? "Deselect" : "Select for comparison"}
        >
          {selected
            ? <CheckSquare className="w-4 h-4 text-[#F59E0B]" />
            : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />}
        </button>
      </div>
    </div>
  );
}

// ── List Row ──────────────────────────────────────────────────────────────────

function StartupListRow({ startup, onSelect }: { startup: Startup; onSelect: () => void }) {
  const latestRound = startup.funding_rounds?.[0] ?? null;
  const roundType   = latestRound?.round_type ?? null;
  const roundStyle  = roundType ? (ROUND_STYLE[roundType] ?? ROUND_STYLE["Other"]) : null;
  return (
    <tr onClick={onSelect} className="border-b border-gray-50 hover:bg-amber-50/40 cursor-pointer transition-colors group">
      <td className="py-3.5 px-5">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black flex-none ${avatarColor(startup.name)}`}>{startup.name[0].toUpperCase()}</div>
          <div>
            <div className="text-sm font-bold text-[#0F172A] group-hover:text-[#F59E0B] transition-colors leading-tight">{startup.name}</div>
            {startup.industry && <div className="text-[10px] text-gray-400 font-medium">{startup.industry}</div>}
          </div>
        </div>
      </td>
      <td className="py-3.5 px-4">
        {roundType && roundStyle ? <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${roundStyle}`}>{roundType}</span> : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="py-3.5 px-4 text-xs text-gray-500">{[startup.city, startup.country].filter(Boolean).join(", ") || "—"}</td>
      <td className="py-3.5 px-4 text-sm font-bold text-[#0F172A]">{fmt(latestRound?.valuation)}</td>
      <td className="py-3.5 px-4 text-sm font-bold text-[#0F172A]">{fmt(totalRaised(startup)) || "—"}</td>
      <td className="py-3.5 px-4 text-xs text-gray-500">{fmtEmp(startup.employee_count)}</td>
      <td className="py-3.5 px-4">
        {startup.founders && startup.founders.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {startup.founders.slice(0, 2).map((f, i) => (
              <span key={i} className="text-[10px] bg-gray-50 border border-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{f.split(" ")[0]}</span>
            ))}
            {startup.founders.length > 2 && <span className="text-[10px] text-gray-400">+{startup.founders.length - 2}</span>}
          </div>
        ) : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="py-3.5 px-4 text-right text-gray-300 group-hover:text-[#F59E0B] transition-colors text-sm">→</td>
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
              className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm text-[#0F172A] placeholder-gray-300 focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/10 transition-all"
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function Startups() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [startups, setStartups]         = useState<Startup[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [showAdd, setShowAdd]           = useState(false);
  const [search, setSearch]             = useState("");
  const [parentSector, setParentSector] = useState("");
  const [subSector, setSubSector]       = useState("");
  const [countryFilter, setCountry]     = useState("");
  const [stageStep, setStageStep]       = useState<StageStep>("all");
  const [headcountStep, setHeadcount]   = useState<HeadcountStep>("all");
  const [timeframe, setTimeframe]       = useState<Timeframe>("all");
  const [viewMode, setView]             = useState<"grid" | "list">("grid");
  const [selectedStartup, setSelected] = useState<Startup | null>(null);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare]   = useState(false);

  const cityParam = searchParams.get("city") ?? "";
  const [cityFilter, setCityFilter] = useState(cityParam);

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else if (next.size < 3) { next.add(id); }
      return next;
    });
  }
  function addPeer(peer: Startup) {
    setSelectedIds((prev) => {
      if (prev.size >= 3 || prev.has(peer.id)) return prev;
      return new Set([...prev, peer.id]);
    });
  }

  useEffect(() => {
    fetchStartups()
      .then(setStartups)
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function clearCityFilter() {
    setCityFilter("");
    setSearchParams((p) => { p.delete("city"); return p; });
  }
  function clearAll() {
    setSearch(""); setParentSector(""); setSubSector(""); setCountry("");
    setStageStep("all"); setHeadcount("all"); setTimeframe("all"); clearCityFilter();
  }

  const countries = useMemo(
    () => [...new Set(startups.map((s) => s.country).filter(Boolean) as string[])].sort(),
    [startups],
  );

  const activeFilterCount = [
    search, parentSector, subSector, countryFilter, cityFilter,
    stageStep !== "all" ? "1" : "",
    headcountStep !== "all" ? "1" : "",
    timeframe !== "all" ? "1" : "",
  ].filter(Boolean).length;

  const cutoffDate = useMemo(() => {
    if (timeframe === "all") return null;
    const months = timeframe === "12m" ? 12 : timeframe === "18m" ? 18 : 36;
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  }, [timeframe]);

  const filtered = useMemo(() => startups.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) &&
          !(s.industry ?? "").toLowerCase().includes(q) &&
          !(s.country ?? "").toLowerCase().includes(q) &&
          !(s.city ?? "").toLowerCase().includes(q) &&
          !(s.description ?? "").toLowerCase().includes(q)) return false;
    }
    if (parentSector) {
      const tax = classifyIndustry(s.industry);
      if (tax.parent !== parentSector) return false;
      if (subSector && tax.sub !== subSector) return false;
    }
    if (countryFilter && s.country !== countryFilter) return false;
    if (cityFilter && !(s.city ?? "").toLowerCase().includes(cityFilter.toLowerCase()) &&
        !(s.country ?? "").toLowerCase().includes(cityFilter.toLowerCase())) return false;
    if (stageStep !== "all") {
      const step = STAGE_STEPS.find((st) => st.value === stageStep);
      if (step && !step.rounds.includes(s.funding_rounds?.[0]?.round_type as RoundType)) return false;
    }
    if (headcountStep !== "all") {
      const n = s.employee_count ?? 0;
      if (headcountStep === "0-50"    && n > 50)              return false;
      if (headcountStep === "51-100"  && (n < 51  || n > 100))  return false;
      if (headcountStep === "101-250" && (n < 101 || n > 250))  return false;
      if (headcountStep === "251-500" && (n < 251 || n > 500))  return false;
      if (headcountStep === "500+"    && n < 501)             return false;
    }
    if (cutoffDate) {
      const hasDateData = s.funding_rounds.some((r) => r.announcement_date);
      if (hasDateData) {
        const hasRecent = s.funding_rounds.some((r) => r.announcement_date && r.announcement_date >= cutoffDate);
        if (!hasRecent) return false;
      }
    }
    return true;
  }), [startups, search, parentSector, subSector, countryFilter, cityFilter, stageStep, headcountStep, cutoffDate]);

  const selectedStartups = useMemo(
    () => startups.filter((s) => selectedIds.has(s.id)),
    [startups, selectedIds],
  );

  const currentStageLabel = STAGE_STEPS.find((s) => s.value === stageStep)?.label ?? "All";
  const currentHeadcountLabel = HEADCOUNT_STEPS.find((s) => s.value === headcountStep)?.label ?? "All";

  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">

        {/* Page header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] flex items-center gap-3">
              Startups
              {cityFilter && <span className="text-lg font-medium text-[#F59E0B]">in {cityFilter}</span>}
              {!loading && (
                <span className="text-sm font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">{filtered.length}</span>
              )}
            </h1>
            <p className="mt-1 text-sm font-medium text-gray-500">AI-researched private companies with funding intelligence.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white border border-gray-200 rounded-[12px] p-1">
              <button onClick={() => setView("grid")} className={`p-1.5 rounded-[8px] transition-all ${viewMode === "grid" ? "bg-[#0F172A] text-white" : "text-gray-400 hover:text-gray-700"}`}><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => setView("list")} className={`p-1.5 rounded-[8px] transition-all ${viewMode === "list" ? "bg-[#0F172A] text-white" : "text-gray-400 hover:text-gray-700"}`}><List className="w-4 h-4" /></button>
            </div>
            <button onClick={() => setShowCompare(true)} disabled={selectedIds.size < 2}
              className={`flex items-center gap-2 rounded-[14px] px-4 py-2.5 text-sm font-bold transition-all ${
                selectedIds.size >= 2 ? "bg-blue-600 text-white shadow-[0_4px_14px_rgba(37,99,235,0.3)] hover:bg-blue-700" : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}>
              <GitCompare className="w-4 h-4" />
              {selectedIds.size >= 2 ? `Compare (${selectedIds.size})` : "Compare"}
            </button>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 rounded-[14px] bg-[#F59E0B] px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_14px_rgba(245,158,11,0.3)] hover:bg-amber-600 transition-all">
              <Plus className="w-4 h-4" />Add Startup
            </button>
          </div>
        </div>

        {/* ── Screener ─────────────────────────────────────────────────────── */}
        <div className="mb-5 space-y-3">

          {/* Row 1: text filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies…"
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-[12px] focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/10 transition-all" />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>

            {/* Hierarchical sector */}
            <HierarchicalSectorFilter
              parentSector={parentSector} onParentChange={setParentSector}
              subSector={subSector}       onSubChange={setSubSector}
            />

            {/* Country */}
            <div className="relative">
              <select value={countryFilter} onChange={(e) => setCountry(e.target.value)}
                className={`appearance-none pl-3 pr-8 py-2 text-xs font-semibold border rounded-[10px] bg-white transition-all focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/20 cursor-pointer ${
                  countryFilter ? "border-[#F59E0B] text-[#0F172A]" : "border-gray-200 text-gray-500"
                }`}>
                <option value="">All Countries</option>
                {countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* Timeframe */}
            <div className="relative">
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                className={`appearance-none pl-3 pr-8 py-2 text-xs font-semibold border rounded-[10px] bg-white transition-all focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/20 cursor-pointer ${
                  timeframe !== "all" ? "border-[#F59E0B] text-[#0F172A]" : "border-gray-200 text-gray-500"
                }`}>
                {TIMEFRAME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* Selection badge */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-[10px] px-3 py-2">
                <span className="text-xs font-semibold text-blue-700">{selectedIds.size} selected</span>
                <button onClick={() => setSelectedIds(new Set())} className="text-blue-400 hover:text-blue-600 transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
            {activeFilterCount > 0 && (
              <button onClick={clearAll} className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-rose-500 transition-colors">
                <X className="w-3.5 h-3.5" />Clear all ({activeFilterCount})
              </button>
            )}
          </div>

          {/* Row 2: sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 bg-white border border-gray-200 rounded-[14px] px-5 py-4">
            {/* Stage slider */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Funding Stage</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-all ${
                  stageStep !== "all" ? "bg-amber-50 text-amber-700 border border-amber-100" : "text-gray-400"
                }`}>{currentStageLabel}</span>
              </div>
              <StepSlider steps={STAGE_STEPS} value={stageStep} onChange={(v) => setStageStep(v as StageStep)} />
            </div>
            {/* Headcount slider */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Headcount</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-all ${
                  headcountStep !== "all" ? "bg-amber-50 text-amber-700 border border-amber-100" : "text-gray-400"
                }`}>{currentHeadcountLabel}</span>
              </div>
              <StepSlider steps={HEADCOUNT_STEPS} value={headcountStep} onChange={(v) => setHeadcount(v as HeadcountStep)} />
            </div>
          </div>

          {/* City chip (URL param) */}
          {cityFilter && (
            <div className="flex items-center gap-2">
              <button onClick={clearCityFilter} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-[#F59E0B] text-white hover:bg-amber-600 transition-all">
                <MapPin className="w-3 h-3" />{cityFilter}<X className="w-3 h-3 ml-0.5" />
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-32"><Loader2 className="w-6 h-6 text-[#F59E0B] animate-spin" /></div>
        ) : loadError ? (
          <div className="flex flex-col items-center py-24 gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm font-semibold text-[#0F172A]">Failed to load startups</p>
            <p className="text-xs text-gray-400 max-w-xs">{loadError}</p>
          </div>
        ) : startups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-16 h-16 rounded-3xl bg-amber-50 flex items-center justify-center mb-6"><Rocket className="w-7 h-7 text-[#F59E0B]" /></div>
            <h2 className="text-xl font-bold text-[#0F172A] mb-3">No startups yet</h2>
            <p className="text-sm text-gray-400 max-w-sm leading-relaxed mb-8">
              Add your first startup — the AI agent will research, validate, and store it with full funding history.
            </p>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-[16px] bg-[#F59E0B] px-6 py-3 text-sm font-bold text-white shadow-[0_4px_14px_rgba(245,158,11,0.3)] hover:bg-amber-600 transition-all">
              <Plus className="w-4 h-4" />Add First Startup
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 gap-3 text-center">
            <Building2 className="w-8 h-8 text-gray-300" />
            <p className="text-sm font-semibold text-gray-400">No companies match these filters</p>
            <button onClick={clearAll} className="text-xs text-[#F59E0B] font-semibold hover:underline">Clear all filters</button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtered.map((s) => (
              <StartupCard key={s.id} startup={s} onSelect={() => setSelected(s)}
                selected={selectedIds.has(s.id)} onToggleSelect={(e) => toggleSelect(s.id, e)} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-[20px] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden">
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
                  {filtered.map((s) => <StartupListRow key={s.id} startup={s} onSelect={() => setSelected(s)} />)}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      <AddStartupDialog open={showAdd} onClose={() => setShowAdd(false)} onSuccess={(s) => setStartups((p) => [s, ...p])} />

      {selectedStartup && (
        <TearsheetModal startup={selectedStartup} allStartups={startups}
          onClose={() => setSelected(null)} onNavigate={(s) => setSelected(s)} />
      )}

      {showCompare && selectedStartups.length >= 2 && (
        <CompareModal startups={selectedStartups} allStartups={startups}
          onClose={() => setShowCompare(false)} onAddPeer={addPeer} />
      )}
    </Layout>
  );
}
