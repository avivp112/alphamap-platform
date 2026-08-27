import React, { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X, Info, Users, Zap, Clock, TrendingUp, Shield,
  AlertTriangle, Layers, PieChart, Building2, CheckCircle,
} from "lucide-react";
import type { Deal } from "../pages/Deals";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  deal: Deal;
  allDeals: Deal[];
  onClose: () => void;
}

// ── Local helpers (self-contained, avoids circular runtime deps) ───────────────

function fmtAmount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function avatarColors(name: string): { bg: string; fg: string } {
  const BG = ["#1e3a5f","#1e2d54","#2d1b47","#1a3d2b","#3d1a1a","#1a3d3d","#3d2d1a","#2d1a3d"];
  const FG = ["#93c5fd","#a5b4fc","#d8b4fe","#6ee7b7","#fca5a5","#67e8f9","#fcd34d","#c4b5fd"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return { bg: BG[h % BG.length], fg: FG[h % FG.length] };
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

const DEAL_TYPE_CFG: Record<string, { bg: string; text: string; border: string; shadow: string }> = {
  "Pre-Seed":        { bg: "rgba(124,58,237,0.08)",  text: "#6d28d9", border: "rgba(139,92,246,0.30)",  shadow: "none" },
  "Seed":            { bg: "rgba(37,99,235,0.08)",   text: "#1d4ed8", border: "rgba(59,130,246,0.30)",   shadow: "none" },
  "Series A":        { bg: "rgba(5,150,105,0.08)",   text: "#047857", border: "rgba(16,185,129,0.30)",   shadow: "none" },
  "Series B":        { bg: "rgba(217,119,6,0.08)",   text: "#b45309", border: "rgba(245,158,11,0.30)",   shadow: "none" },
  "Series C":        { bg: "rgba(234,88,12,0.08)",   text: "#c2410c", border: "rgba(249,115,22,0.30)",   shadow: "none" },
  "Series D":        { bg: "rgba(220,38,38,0.08)",   text: "#b91c1c", border: "rgba(239,68,68,0.30)",    shadow: "none" },
  "Series E+":       { bg: "rgba(190,18,60,0.08)",   text: "#9f1239", border: "rgba(244,63,94,0.30)",    shadow: "none" },
  "Growth":          { bg: "rgba(67,56,202,0.08)",   text: "#4338ca", border: "rgba(99,102,241,0.30)",   shadow: "none" },
  "M&A":             { bg: "rgba(6,182,212,0.08)",   text: "#0e7490", border: "rgba(34,211,238,0.30)",   shadow: "none" },
  "Acquisition":     { bg: "rgba(6,182,212,0.08)",   text: "#0e7490", border: "rgba(34,211,238,0.30)",   shadow: "none" },
  "Bridge":          { bg: "rgba(2,132,199,0.08)",   text: "#0369a1", border: "rgba(14,165,233,0.30)",   shadow: "none" },
  "Grant":           { bg: "rgba(101,163,13,0.08)",  text: "#4d7c0f", border: "rgba(132,204,22,0.30)",   shadow: "none" },
  "Other":           { bg: "rgba(71,85,105,0.08)",   text: "#475569", border: "rgba(100,116,139,0.30)",  shadow: "none" },
  "Form D":          { bg: "rgba(245,158,11,0.10)",  text: "#92400e", border: "rgba(245,158,11,0.38)",   shadow: "none" },
  "Form D (Equity)": { bg: "rgba(245,158,11,0.10)",  text: "#92400e", border: "rgba(245,158,11,0.38)",   shadow: "none" },
  "Form D (Debt)":   { bg: "rgba(251,146,60,0.10)",  text: "#9a3412", border: "rgba(251,146,60,0.38)",   shadow: "none" },
};

function getDealTypeCfg(t: string) {
  if (t.startsWith("Form D")) return DEAL_TYPE_CFG["Form D (Equity)"];
  return DEAL_TYPE_CFG[t] ?? DEAL_TYPE_CFG.Other;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ text }: { text: string }) {
  return (
    <div className="group relative inline-flex items-center">
      <Info className="w-3 h-3 text-slate-600 cursor-help flex-none" />
      <div
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 w-60 text-[10px] leading-relaxed text-slate-300
          invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150
          pointer-events-none z-[70]"
        style={{ background: "#1a2840", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "10px", padding: "8px 10px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}
      >
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent" style={{ borderTopColor: "#1a2840" }} />
      </div>
    </div>
  );
}

// ── Widget shell ──────────────────────────────────────────────────────────────

function Widget({ title, icon: Icon, accent = "#22d3ee", children, titleExtra }: {
  title: string;
  icon: React.ElementType;
  accent?: string;
  children: React.ReactNode;
  titleExtra?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg overflow-hidden bg-white"
      style={{
        border: "1px solid #E5E7EB",
        boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      <div className="h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}55, transparent)` }} />
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-2 mb-3">
          <Icon className="w-3.5 h-3.5 flex-none" style={{ color: accent }} />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.12em]">{title}</span>
          {titleExtra && <div className="ml-auto">{titleExtra}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

// ── 1. Comparable Deals ───────────────────────────────────────────────────────

function CompsWidget({ deal, allDeals }: { deal: Deal; allDeals: Deal[] }) {
  const { t } = useTranslation();
  const comps = allDeals
    .filter(d => d.id !== deal.id && d.sector === deal.sector)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  return (
    <Widget title="Comparable Deals" icon={Layers} accent="#22d3ee"
      titleExtra={
        <span className="text-[9px] font-bold text-cyan-700 px-1.5 py-0.5 rounded-full"
          style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.20)" }}>
          {deal.sector}
        </span>
      }
    >
      {comps.length === 0 ? (
        <div className="flex items-center gap-2 py-2 text-[11px] text-gray-400">
          <Building2 className="w-4 h-4 flex-none" />
          No other {deal.sector} deals tracked yet — comps will populate as data grows.
        </div>
      ) : (
        <>
          <div className="grid pb-1.5 mb-1 gap-3 text-[9px] font-bold text-gray-400 uppercase tracking-[0.12em] border-b border-gray-100"
            style={{ gridTemplateColumns: "1fr 104px 68px 64px" }}>
            <span>{t("common.company")}</span><span>{t("common.type")}</span><span>{t("common.size")}</span><span>{t("deals.date")}</span>
          </div>
          {comps.map((comp, i) => {
            const cfg = getDealTypeCfg(comp.deal_type);
            const av  = avatarColors(comp.company_name);
            return (
              <div key={comp.id} className="grid gap-3 py-2 items-center"
                style={{ gridTemplateColumns: "1fr 104px 68px 64px", borderBottom: i < comps.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="w-5 h-5 rounded flex-none flex items-center justify-center text-[9px] font-black"
                    style={{ background: av.bg, color: av.fg }}>{initials(comp.company_name)}</div>
                  <span className="text-[11px] text-gray-700 truncate">{comp.company_name}</span>
                </div>
                <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                  {comp.deal_type}
                </span>
                <span className="text-xs font-black text-gray-900 tabular-nums">{fmtAmount(comp.deal_size)}</span>
                <span className="text-[10px] text-gray-400">{fmtDateShort(comp.date)}</span>
              </div>
            );
          })}
        </>
      )}
    </Widget>
  );
}

// ── 2. Investor Syndicate ─────────────────────────────────────────────────────

const SECTOR_POOL: Record<string, string[]> = {
  "AI & ML":           ["Tiger Global", "GV (Google Ventures)", "Coatue Management", "General Catalyst", "NEA", "Lightspeed"],
  "Cybersecurity":     ["Bessemer Venture Partners", "Insight Partners", "ForgePoint Capital", "CrowdStrike Ventures", "SYN Ventures"],
  "Fintech":           ["Ribbit Capital", "QED Investors", "Accel", "Stripe Ventures", "Portage Ventures"],
  "SaaS":              ["Bessemer Venture Partners", "Salesforce Ventures", "Battery Ventures", "Lightspeed", "Sapphire Ventures"],
  "HealthTech":        ["a16z Bio", "ARCH Venture Partners", "GV", "OrbiMed", "General Catalyst"],
  "AI Infrastructure": ["NVIDIA Ventures", "Intel Capital", "Databricks Ventures", "Amplify Partners", "Race Capital"],
  "Legal Tech":        ["Thomvest Ventures", "Headline", "Base10 Partners", "8VC", "Lux Capital"],
  "DeepTech":          ["Breakthrough Energy Ventures", "Lux Capital", "DCVC", "Founders Fund", "Khosla Ventures"],
  "default":           ["Andreessen Horowitz", "Sequoia Capital", "Accel", "Index Ventures", "Lightspeed", "Bessemer"],
};

function InvAvatar({ name }: { name: string }) {
  const av = avatarColors(name);
  return (
    <div className="w-6 h-6 rounded-lg flex-none flex items-center justify-center text-[9px] font-black"
      style={{ background: av.bg, color: av.fg }}>
      {initials(name)}
    </div>
  );
}

function InvestorSyndicateWidget({ deal }: { deal: Deal }) {
  const { t } = useTranslation();
  const hasInvestors = deal.lead_investors.length > 0;
  const isFormD      = deal.deal_type.startsWith("Form D");

  if (!hasInvestors || isFormD) {
    return (
      <Widget title="Investor Syndicate" icon={Users} accent="#a78bfa">
        <div className="flex flex-col items-center py-4 gap-2 text-center">
          <Shield className="w-7 h-7 text-gray-300" />
          <p className="text-[11px] text-gray-400 leading-relaxed">
            {isFormD
              ? "SEC Form D filings do not require investor identification. Syndicate undisclosed."
              : "No investor information on record for this deal."}
          </p>
        </div>
      </Widget>
    );
  }

  let h = 0;
  for (const c of deal.company_name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const pool     = SECTOR_POOL[deal.sector] ?? SECTOR_POOL.default;
  const notLead  = pool.filter(p => !deal.lead_investors.includes(p));
  const mockParticipating = [
    notLead[h % notLead.length],
    notLead[(h + 3) % notLead.length],
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const [lead, ...coLeads] = deal.lead_investors;

  return (
    <Widget title="Investor Syndicate" icon={Users} accent="#a78bfa">
      <div className="space-y-3.5">
        {/* Lead */}
        <div>
          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.12em] mb-2">{t("dealModal.lead")}</div>
          <div className="flex items-center gap-2 py-0.5">
            <InvAvatar name={lead} />
            <span className="text-xs font-bold text-gray-900 flex-1 truncate">{lead}</span>
            <span className="text-[9px] font-bold text-violet-700 px-2 py-0.5 rounded-full"
              style={{ background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.25)" }}>LEAD</span>
          </div>
        </div>

        {coLeads.length > 0 && (
          <div>
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.12em] mb-2">Co-Lead</div>
            {coLeads.map(inv => (
              <div key={inv} className="flex items-center gap-2 py-0.5">
                <InvAvatar name={inv} />
                <span className="text-xs text-gray-700 flex-1 truncate">{inv}</span>
                <span className="text-[9px] font-bold text-cyan-700 px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.20)" }}>CO-LEAD</span>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="flex items-center gap-1 mb-2">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.12em]">{t("dealModal.participating")}</span>
            <span className="text-[9px] text-gray-300">(est.)</span>
          </div>
          {mockParticipating.map(inv => (
            <div key={inv} className="flex items-center gap-2 py-0.5">
              <InvAvatar name={inv} />
              <span className="text-xs text-gray-500 flex-1 truncate">{inv}</span>
            </div>
          ))}
        </div>
      </div>
    </Widget>
  );
}

// ── 3. Cap Table & Dilution ───────────────────────────────────────────────────

const DILUTION_BENCHMARKS: Record<string, { min: number; max: number }> = {
  "Pre-Seed":        { min: 20, max: 25 },
  "Seed":            { min: 15, max: 22 },
  "Series A":        { min: 15, max: 20 },
  "Series B":        { min: 12, max: 18 },
  "Series C":        { min: 10, max: 15 },
  "Series D":        { min: 8,  max: 12 },
  "Series E+":       { min: 5,  max: 10 },
  "Growth":          { min: 8,  max: 15 },
  "Bridge":          { min: 3,  max: 8  },
  "Form D":          { min: 10, max: 20 },
  "Form D (Equity)": { min: 10, max: 20 },
  "Form D (Debt)":   { min: 0,  max: 0  },
};

function DonutChart({ pct, color }: { pct: number; color: string }) {
  const r = 36, cx = 50, cy = 50;
  const circ = 2 * Math.PI * r;
  const dash  = Math.min(pct / 100, 1) * circ;
  return (
    <svg width="92" height="92" viewBox="0 0 100 100" className="flex-none">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F3F4F6" strokeWidth="10" />
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke={color} strokeWidth="10"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="47" textAnchor="middle" fill="#111827" fontSize="14" fontWeight="bold" fontFamily="system-ui">
        {pct.toFixed(0)}%
      </text>
      <text x="50" y="60" textAnchor="middle" fill="#9CA3AF" fontSize="8" fontFamily="system-ui">equity</text>
    </svg>
  );
}

function DilutionWidget({ deal }: { deal: Deal }) {
  const { t } = useTranslation();
  const isMA   = deal.deal_type === "M&A" || deal.deal_type === "Acquisition";
  const isDebt = deal.deal_type === "Form D (Debt)";

  let equityPct: number;
  let isExact = false;
  let color = "#a78bfa";
  let note  = "";

  if (isMA) {
    equityPct = 100;
    color = "#67e8f9";
    note  = "100% acquisition — full buyout";
  } else if (isDebt) {
    equityPct = 0;
    color = "#f97316";
    note  = "Debt offering — no equity dilution";
  } else if (deal.deal_size != null && deal.valuation != null && deal.valuation > 0 && !deal.is_valuation_estimated) {
    equityPct = Math.min((deal.deal_size / deal.valuation) * 100, 100);
    isExact   = true;
    note      = "Calculated from disclosed valuation";
  } else {
    const bench = DILUTION_BENCHMARKS[deal.deal_type] ?? { min: 10, max: 20 };
    equityPct   = (bench.min + bench.max) / 2;
    note        = `${bench.min}–${bench.max}% industry benchmark for ${deal.deal_type}`;
  }

  const foundersPct = Math.max(0, 100 - equityPct);

  return (
    <Widget title="Cap Table & Dilution" icon={PieChart} accent="#a78bfa"
      titleExtra={
        <Tooltip text={
          isExact
            ? "Dilution = Amount Raised ÷ Post-Money Valuation. Calculated from disclosed figures."
            : "Exact cap table not disclosed. AlphaMap applies standard VC benchmark dilution ranges for this round stage. Actual terms vary based on option pool refresh, anti-dilution clauses, and investor preferences."
        } />
      }
    >
      <div className="flex items-center gap-4">
        <DonutChart pct={equityPct} color={color} />
        <div className="flex-1 space-y-2.5 min-w-0">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] text-gray-500">{t("dealModal.investorEquity")}</span>
              <span className="text-xs font-bold tabular-nums" style={{ color }}>{equityPct.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden bg-gray-100">
              <div className="h-full rounded-full" style={{ width: `${Math.min(equityPct, 100)}%`, background: color }} />
            </div>
          </div>
          {!isMA && !isDebt && (
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-gray-500">{t("dealModal.foundersEmployees")}</span>
                <span className="text-xs font-bold text-emerald-600 tabular-nums">{foundersPct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden bg-gray-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${foundersPct}%` }} />
              </div>
            </div>
          )}
          <p className={`text-[9px] leading-relaxed ${isExact ? "text-emerald-600" : "text-gray-400"}`}>{note}</p>
        </div>
      </div>
    </Widget>
  );
}

// ── 4. Burn Rate & Runway ─────────────────────────────────────────────────────

function estimateHeadcount(deal: Deal): number | null {
  if (deal.deal_type === "M&A" || deal.deal_type === "Acquisition") return null;
  if (!deal.deal_size) return null;
  const base: Record<string, number> = {
    "Pre-Seed": 6, "Seed": 22, "Bridge": 40,
    "Form D": 16, "Form D (Equity)": 16, "Form D (Debt)": 12,
    "Series A": 68, "Series B": 190, "Series C": 430,
    "Series D": 780, "Series E+": 1450, "Growth": 640,
  };
  const b = base[deal.deal_type] ?? 55;
  let h = 0;
  for (const c of deal.company_name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return Math.round(b * (0.7 + (h % 600) / 1000));
}

function RunwayWidget({ deal }: { deal: Deal }) {
  const BURN_PER_EMPLOYEE = 12_000;
  const isMA   = deal.deal_type === "M&A" || deal.deal_type === "Acquisition";

  if (isMA || !deal.deal_size) {
    return (
      <Widget title="Burn Rate & Runway" icon={Clock} accent="#f59e0b">
        <p className="text-[11px] text-gray-400 py-2 leading-relaxed">
          {isMA ? "Not applicable — this is an acquisition event, not an operating capital raise."
                : "Deal size undisclosed — runway cannot be computed."}
        </p>
      </Widget>
    );
  }

  const headcount   = estimateHeadcount(deal);
  if (!headcount) {
    return (
      <Widget title="Burn Rate & Runway" icon={Clock} accent="#f59e0b">
        <p className="text-[11px] text-gray-400 py-2 leading-relaxed">Headcount data unavailable — runway estimate requires employee count.</p>
      </Widget>
    );
  }

  const monthlyBurn = headcount * BURN_PER_EMPLOYEE;
  const runway      = deal.deal_size / monthlyBurn;

  const color  = runway >= 24 ? "#34d399" : runway >= 12 ? "#fbbf24" : "#f87171";
  const label  = runway >= 24 ? "Healthy"  : runway >= 12 ? "Adequate" : "Critical";
  const barPct = Math.min((runway / 36) * 100, 100);

  const RunwayIcon = runway >= 12 ? TrendingUp : AlertTriangle;

  return (
    <Widget title="Burn Rate & Runway" icon={Clock} accent="#f59e0b"
      titleExtra={
        <Tooltip text={`Runway = Amount Raised ÷ (Headcount × $12,000/mo). The $12k blended rate covers salary, benefits, cloud compute, office, and G&A — calibrated for US tech startups at this stage. Headcount estimated from deal round type. Actual burn varies by geography and product maturity.`} />
      }
    >
      <div className="space-y-3">
        {/* Key number */}
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-2xl font-black leading-none" style={{ color }}>
              {runway < 1 ? "<1" : runway.toFixed(0)}
              <span className="text-sm font-semibold ml-1 text-gray-400">mo</span>
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">estimated runway</div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
            style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
            <RunwayIcon className="w-3.5 h-3.5" style={{ color }} />
            <span className="text-[10px] font-bold" style={{ color }}>{label}</span>
          </div>
        </div>

        {/* Progress bar with 12 / 24 month markers */}
        <div className="relative">
          <div className="h-2 rounded-full overflow-hidden bg-gray-100">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${barPct}%`, background: color }} />
          </div>
          <div className="absolute top-0 bottom-0 w-px opacity-30 bg-gray-400" style={{ left: `${(12 / 36) * 100}%` }} />
          <div className="absolute top-0 bottom-0 w-px opacity-30 bg-gray-400" style={{ left: `${(24 / 36) * 100}%` }} />
        </div>
        <div className="flex justify-between text-[9px] text-gray-300 -mt-1">
          <span>0</span><span style={{ marginLeft: `${(12/36)*100 - 8}%` }}>12mo</span>
          <span style={{ marginLeft: `${(24/36-12/36)*100 - 10}%` }}>24mo</span><span>36mo+</span>
        </div>

        {/* Assumptions breakdown */}
        <div className="rounded-lg p-2.5 space-y-1.5 bg-gray-50 border border-gray-100">
          {[
            ["Est. headcount",       `${headcount.toLocaleString()} employees`],
            ["Blended monthly burn", `${fmtAmount(monthlyBurn)}/mo`],
            ["Capital raised",       fmtAmount(deal.deal_size)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-[10px]">
              <span className="text-gray-400">{k}</span>
              <span className="text-gray-700 font-semibold">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </Widget>
  );
}

// ── 5. Capital Velocity ───────────────────────────────────────────────────────

const ROUND_PREV: Record<string, { prev: string | null; gap: number }> = {
  "Pre-Seed":        { prev: null,          gap: 0  },
  "Seed":            { prev: "Pre-Seed",    gap: 12 },
  "Bridge":          { prev: "Seed",        gap: 10 },
  "Series A":        { prev: "Seed",        gap: 18 },
  "Series B":        { prev: "Series A",    gap: 20 },
  "Series C":        { prev: "Series B",    gap: 20 },
  "Series D":        { prev: "Series C",    gap: 22 },
  "Series E+":       { prev: "Series D",    gap: 24 },
  "Growth":          { prev: "Series C",    gap: 24 },
  "M&A":             { prev: null,          gap: 0  },
  "Acquisition":     { prev: null,          gap: 0  },
};

function VelocityWidget({ deal }: { deal: Deal }) {
  const isMA     = deal.deal_type === "M&A" || deal.deal_type === "Acquisition";
  const isFormD  = deal.deal_type.startsWith("Form D");

  if (isMA) {
    return (
      <Widget title="Capital Velocity" icon={TrendingUp} accent="#34d399">
        <p className="text-[11px] text-gray-400 py-2 leading-relaxed">Capital velocity not applicable to M&A / acquisition events.</p>
      </Widget>
    );
  }

  const info  = ROUND_PREV[deal.deal_type];
  const gap   = info?.gap ?? 18;
  const prev  = info?.prev ?? null;

  const velocityLabel = gap <= 12 ? "Fast" : gap <= 20 ? "Typical" : "Extended";
  const velocityColor = gap <= 12 ? "#34d399" : gap <= 20 ? "#22d3ee" : "#fbbf24";

  const estPrevDate = new Date(deal.date);
  estPrevDate.setMonth(estPrevDate.getMonth() - gap);
  const prevDateStr = estPrevDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });

  return (
    <Widget title="Capital Velocity" icon={TrendingUp} accent="#34d399">
      <div className="space-y-3">
        {isFormD ? (
          <div className="text-[11px] text-gray-500 py-1 leading-relaxed">
            SEC Form D typically represents the first institutional raise. No prior round on record.
          </div>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <div>
                <div className="text-2xl font-black leading-none text-gray-900">
                  {gap > 0 ? `~${gap}` : "—"}
                  {gap > 0 && <span className="text-sm font-semibold ml-1 text-gray-400">mo</span>}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {gap > 0 ? "since last raise" : "first institutional round"}
                </div>
              </div>
              {gap > 0 && (
                <span className="mb-0.5 text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                  style={{ background: `${velocityColor}15`, border: `1px solid ${velocityColor}30`, color: velocityColor }}>
                  {velocityLabel}
                </span>
              )}
            </div>

            {/* Stage flow */}
            {prev && (
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-gray-500 font-medium">{prev}</span>
                <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, rgba(100,116,139,0.25), ${velocityColor}60)` }} />
                <span className="font-bold text-gray-900">{deal.deal_type}</span>
              </div>
            )}
            {prev && (
              <div className="text-[10px] text-gray-400">
                Est. prev. round: <span className="text-gray-600 font-medium">{prevDateStr}</span>
              </div>
            )}
          </>
        )}

        {/* Context note */}
        <div className="rounded-lg p-2.5 bg-gray-50 border border-gray-100">
          <p className="text-[9px] text-gray-500 leading-relaxed">
            {isFormD
              ? "ℹ SEC Form D often precedes a Seed or Series A within 6–18 months."
              : gap <= 12
              ? "⚡ Hyper-fast cadence signals exceptional growth or aggressive VC backing — high burn likely."
              : gap <= 20
              ? "✓ Cadence aligns with typical VC round-to-round timelines (18–24 months)."
              : "⚠ Extended gap may indicate a longer path to PMF, or deliberate capital efficiency."}
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-[9px] text-gray-300">
          <Info className="w-3 h-3 flex-none" />
          <span>Velocity estimated from industry-average round cadences · {new Date(deal.date).getFullYear()} cohort</span>
        </div>
      </div>
    </Widget>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function DealModal({ deal, allDeals, onClose }: Props) {
  const { t } = useTranslation();
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prev;
    };
  }, [handleKey]);

  const av  = avatarColors(deal.company_name);
  const cfg = getDealTypeCfg(deal.deal_type);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(6,13,25,0.82)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-[10px] bg-white"
        style={{
          border: "1px solid rgba(15,23,42,0.08)",
          boxShadow: "0 32px 80px rgba(15,23,42,0.30), 0 0 0 1px rgba(15,23,42,0.02)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header (blue-gray, matches VC/Startup detail modals) ── */}
        <div className="px-6 pt-6 pb-4 flex items-start gap-4 rounded-t-[10px]"
          style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
          <div className="w-12 h-12 rounded-lg flex items-center justify-center text-lg font-black flex-none shrink-0"
            style={{ background: av.bg, color: av.fg }}>
            {initials(deal.company_name)}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <h2 className="text-xl font-black text-[#0F172A] tracking-tight leading-none">{deal.company_name}</h2>
              <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/70"
                style={{ color: cfg.text, border: `1px solid rgba(15,23,42,0.12)` }}>
                {deal.deal_type}
              </span>
              {deal.company_id && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/70 text-emerald-700"
                  style={{ border: "1px solid rgba(15,23,42,0.12)" }}
                  title="SEC legal name automatically matched to a startup in the AlphaMap database via entity resolution"
                >
                  <CheckCircle className="w-3 h-3" />{t("dealModal.verifiedEntity")}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-[#0F172A]/60">
              <span>{fmtDateFull(deal.date)}</span>
              {deal.country && <><span className="text-[#0F172A]/30">·</span><span>{deal.country}</span></>}
              {deal.sector  && <><span className="text-[#0F172A]/30">·</span><span className="text-[#0F172A]/75">{deal.sector}</span></>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#0F172A]/50 hover:text-[#0F172A] transition-all"
            style={{ background: "rgba(255,255,255,0)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.35)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Quick metrics strip ── */}
        <div className="grid grid-cols-3 gap-px bg-gray-100 border-b border-gray-100">
          {[
            {
              label: "Deal Size",
              value: fmtAmount(deal.deal_size),
              valueClass: "text-gray-900",
              isEstimated: false,
            },
            {
              label: "Valuation",
              value: deal.valuation ? `${deal.is_valuation_estimated ? "~" : ""}${fmtAmount(deal.valuation)}` : "—",
              valueClass: deal.valuation
                ? deal.is_valuation_estimated ? "text-amber-700 italic" : "text-gray-900"
                : "text-gray-400",
              isEstimated: deal.is_valuation_estimated && !!deal.valuation,
            },
            {
              label: "Lead Investor",
              value: deal.lead_investors[0] ?? (deal.deal_type.startsWith("Form D") ? "Undisclosed" : "—"),
              valueClass: deal.lead_investors[0] ? "text-gray-700" : "text-gray-400",
              isEstimated: false,
            },
          ].map(({ label, value, valueClass, isEstimated }) => (
            <div key={label} className="px-5 py-3.5 bg-white">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.12em] mb-1">{label}</div>
              <div className={`text-sm font-black leading-tight flex items-center gap-1 ${valueClass}`}>
                {isEstimated && <Zap className="w-3 h-3 text-amber-500 flex-none" />}
                <span className="truncate">{value}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Widgets ── */}
        <div className="p-5 space-y-4">
          <CompsWidget deal={deal} allDeals={allDeals} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InvestorSyndicateWidget deal={deal} />
            <DilutionWidget deal={deal} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <RunwayWidget deal={deal} />
            <VelocityWidget deal={deal} />
          </div>
        </div>
      </div>
    </div>
  );
}
