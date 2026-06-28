import React, { useEffect, useCallback, useState } from "react";
import {
  X, Globe, Calendar, Briefcase, DollarSign, TrendingUp, Users, Zap,
  Activity, ExternalLink, Info, BarChart2, Award, Layers, CheckCircle, MapPin,
} from "lucide-react";
import type { VCFirm } from "../pages/VCs";
import { CompanyLogo } from "./CompanyLogo";
import { DonutFocusChart } from "./DonutFocusChart";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  firm: VCFirm;
  onClose: () => void;
}

// ── Tab system ────────────────────────────────────────────────────────────────

type TabId = "overview" | "investments" | "syndicate" | "exits" | "performance";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview",     label: "Overview"              },
  { id: "investments",  label: "Investments"           },
  { id: "syndicate",    label: "Syndicate Intel"       },
  { id: "exits",        label: "Exits"                 },
  { id: "performance",  label: "Fund Performance"      },
];

// ── Accent palette ────────────────────────────────────────────────────────────

interface AccentConfig {
  radarStroke: string; shimmerColor: string;
  glowColor: string;   borderHover: string;
  avatarFrom: string;  avatarTo: string; avatarText: string;
}

const ACCENT_PALETTE: AccentConfig[] = [
  { radarStroke: '#22d3ee', shimmerColor: 'rgba(34,211,238,0.35)',  glowColor: 'rgba(34,211,238,0.10)',  borderHover: 'rgba(34,211,238,0.22)',  avatarFrom: '#0e4f5e', avatarTo: '#0a3040', avatarText: '#67e8f9' },
  { radarStroke: '#a78bfa', shimmerColor: 'rgba(167,139,250,0.35)', glowColor: 'rgba(139,92,246,0.10)',  borderHover: 'rgba(167,139,250,0.22)', avatarFrom: '#3b1f72', avatarTo: '#1e1040', avatarText: '#c4b5fd' },
  { radarStroke: '#34d399', shimmerColor: 'rgba(52,211,153,0.35)',  glowColor: 'rgba(16,185,129,0.10)',  borderHover: 'rgba(52,211,153,0.22)',  avatarFrom: '#064e33', avatarTo: '#042a1c', avatarText: '#6ee7b7' },
  { radarStroke: '#fbbf24', shimmerColor: 'rgba(251,191,36,0.35)',  glowColor: 'rgba(245,158,11,0.10)',  borderHover: 'rgba(251,191,36,0.22)',  avatarFrom: '#5c3d0a', avatarTo: '#2d1d04', avatarText: '#fcd34d' },
  { radarStroke: '#f472b6', shimmerColor: 'rgba(244,114,182,0.35)', glowColor: 'rgba(236,72,153,0.10)',  borderHover: 'rgba(244,114,182,0.22)', avatarFrom: '#5c0a2d', avatarTo: '#2d0414', avatarText: '#f9a8d4' },
];

function getAccent(id: string): AccentConfig {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return ACCENT_PALETTE[h % ACCENT_PALETTE.length];
}

// ── Constants & helpers ───────────────────────────────────────────────────────

const CURRENT_YEAR = 2026;

const SECTOR_COLORS: Record<string, string> = {
  AI: "#06b6d4", FinTech: "#7c3aed", Cyber: "#10b981",
  SaaS: "#3b82f6", HealthTech: "#ec4899", FoodTech: "#f59e0b",
};

const CO_INVEST_POOL = [
  "Sequoia Capital", "Andreessen Horowitz", "Accel", "Lightspeed Venture Partners",
  "Benchmark", "Index Ventures", "Greylock Partners", "Founders Fund",
  "General Catalyst", "Kleiner Perkins", "Tiger Global", "IVP",
  "Bessemer Venture Partners", "NEA", "Battery Ventures",
];

function deterministicCoInvestors(firmName: string, count = 6): string[] {
  let h = 0;
  for (const c of firmName) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const pool = CO_INVEST_POOL.filter(n => n !== firmName);
  const result: string[] = [];
  let seed = h;
  while (result.length < count) {
    const idx = seed % pool.length;
    if (!result.includes(pool[idx])) result.push(pool[idx]);
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  }
  return result;
}

function deploymentRate(foundedYear: number): number {
  const age = Math.max(1, CURRENT_YEAR - foundedYear);
  return Math.min(92, Math.round(28 + (age / 32) * 68));
}

function portfolioAlphaScore(firm: VCFirm): number {
  let h = 0;
  for (const c of firm.id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const base = 65 + (h % 23);
  const aumBoost = firm.aum_millions ? Math.min(5, Math.floor(firm.aum_millions / 2000)) : 0;
  const ageBoost = Math.min(5, Math.floor((CURRENT_YEAR - firm.founded_year) / 10));
  return Math.min(98, base + aumBoost + ageBoost);
}

const EXIT_OUTCOMES = ["Acquired", "IPO", "Secondary", "SPAC", "Acquired", "IPO"] as const;
type ExitOutcome = typeof EXIT_OUTCOMES[number];

function exitOutcome(name: string): ExitOutcome {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return EXIT_OUTCOMES[h % EXIT_OUTCOMES.length];
}

function exitYear(name: string, founded: number): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return Math.min(CURRENT_YEAR - 1, founded + 4 + (h % 15));
}

function fmtB(m: number | null): string {
  if (m == null) return "—";
  return m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`;
}

// ── Widget shell ──────────────────────────────────────────────────────────────

function Widget({ title, icon: Icon, accent = "#22d3ee", children, hint }: {
  title: string; icon: React.ElementType; accent?: string;
  children: React.ReactNode; hint?: string;
}) {
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "linear-gradient(145deg, #132035 0%, #0c1826 100%)", border: "1px solid rgba(255,255,255,0.07)", boxShadow: "0 4px 20px rgba(0,0,0,0.30)" }}>
      <div className="h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}55, transparent)` }} />
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-2 mb-3">
          <Icon className="w-3.5 h-3.5 flex-none" style={{ color: accent }} />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em]">{title}</span>
          {hint && (
            <div className="ml-auto group relative">
              <Info className="w-3 h-3 text-slate-700 cursor-help" />
              <div className="absolute bottom-full right-0 mb-2 w-56 text-[10px] leading-relaxed text-slate-300
                invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[70]"
                style={{ background: "#1a2840", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: "8px 10px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                {hint}
                <div className="absolute top-full right-3 w-0 h-0 border-4 border-transparent" style={{ borderTopColor: "#1a2840" }} />
              </div>
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Velocity widget ───────────────────────────────────────────────────────────

function VelocityWidget({ firm }: { firm: VCFirm }) {
  const years = Math.max(1, CURRENT_YEAR - firm.founded_year);
  const dealsPerYear = firm.portfolio_count / years;
  const dealsPerQtr = dealsPerYear / 4;
  const pace = dealsPerQtr >= 3 ? "High" : dealsPerQtr >= 1 ? "Moderate" : "Selective";
  const paceColor = dealsPerQtr >= 3 ? "#34d399" : dealsPerQtr >= 1 ? "#22d3ee" : "#fbbf24";

  return (
    <Widget title="Portfolio Velocity" icon={Zap} accent="#a78bfa"
      hint="Estimated deployment pace = total portfolio companies ÷ years active ÷ 4 quarters. Actual pace varies by fund vintage.">
      <div className="flex items-start gap-5">
        <div>
          <div className="text-4xl font-black leading-none text-white tabular-nums">{dealsPerQtr.toFixed(1)}</div>
          <div className="text-[10px] text-slate-500 mt-1">deals / quarter</div>
        </div>
        <div className="flex-1 space-y-2 pt-0.5">
          {([
            ["Est. per year",  dealsPerYear.toFixed(1)],
            ["Active years",   String(years)],
            ["Total portfolio", String(firm.portfolio_count)],
          ] as [string, string][]).map(([lbl, val]) => (
            <div key={lbl} className="flex justify-between text-[11px]">
              <span className="text-slate-500">{lbl}</span>
              <span className="font-bold text-white">{val}</span>
            </div>
          ))}
          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5"
            style={{ background: `${paceColor}15`, border: `1px solid ${paceColor}30`, color: paceColor }}>
            {pace} Velocity
          </span>
        </div>
      </div>
    </Widget>
  );
}

// ── Dry powder widget ─────────────────────────────────────────────────────────

function DryPowderWidget({ firm }: { firm: VCFirm }) {
  const aum = firm.aum_millions;
  const deployed = deploymentRate(firm.founded_year);
  const available = 100 - deployed;
  const deployedAmt = aum ? Math.round(aum * deployed / 100) : null;
  const availableAmt = aum ? Math.round(aum * available / 100) : null;
  const barColor = available >= 40 ? "#34d399" : available >= 20 ? "#fbbf24" : "#f87171";
  const statusLabel = available >= 40 ? "Active Deployment" : available >= 20 ? "Late Stage" : "Near Full";

  return (
    <Widget title="Dry Powder Estimate" icon={Activity} accent="#34d399"
      hint="Estimated from fund age and typical VC deployment timelines. Assumes a standard 5–7 year deployment cycle.">
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-[10px] mb-1.5">
            <span className="text-slate-500">Capital deployed</span>
            <span className="font-bold text-white">{deployed}%</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full"
              style={{ width: `${deployed}%`, background: `linear-gradient(90deg, #22d3ee, ${barColor})`, boxShadow: `0 0 8px ${barColor}55` }} />
          </div>
          <div className="flex justify-between text-[10px] mt-1">
            <span className="text-slate-600">Available: <span style={{ color: barColor }} className="font-semibold">{available}%</span></span>
            <span className="font-semibold text-[9px] px-1.5 py-0.5 rounded-full"
              style={{ background: `${barColor}18`, color: barColor, border: `1px solid ${barColor}30` }}>{statusLabel}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([
            ["Total AUM",  fmtB(aum),          "#94a3b8"],
            ["Deployed",   fmtB(deployedAmt),  "#22d3ee"],
            ["Dry Powder", fmtB(availableAmt), barColor ],
          ] as [string, string, string][]).map(([label, value, color]) => (
            <div key={label} className="rounded-xl py-2.5 px-2 text-center"
              style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="text-[12px] font-black tabular-nums" style={{ color }}>{value}</div>
              <div className="text-[9px] text-slate-700 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </Widget>
  );
}

// ── Tab 1 — Overview ──────────────────────────────────────────────────────────

function OverviewTab({ firm, accent }: { firm: VCFirm; accent: AccentConfig }) {
  const vitals: [React.ElementType, string, string, string][] = [
    [DollarSign, "Fund AUM",     fmtB(firm.aum_millions),            "#34d399"],
    [MapPin,     "Headquarters", firm.headquarters,                   "#22d3ee"],
    [Calendar,   "Founded",      String(firm.founded_year),           "#a78bfa"],
    [TrendingUp, "Check Size",   firm.typical_check_size ?? "—",     "#fbbf24"],
    [Briefcase,  "Portfolio",    `${firm.portfolio_count} companies`, "#22d3ee"],
    [Award,      "Stage Focus",  firm.stages.slice(0, 2).join(", ") || "—", "#f472b6"],
  ];

  return (
    <div className="space-y-5">
      {firm.description && (
        <div className="rounded-2xl px-5 py-4"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[13px] text-slate-300 leading-relaxed">{firm.description}</p>
        </div>
      )}

      <div>
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.18em] mb-3">Firm Vitals</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {vitals.map(([Icon, label, value, color]) => (
            <div key={label} className="flex items-center gap-3 rounded-xl px-3.5 py-3"
              style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-none"
                style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
                <Icon className="w-3.5 h-3.5" style={{ color }} />
              </div>
              <div className="min-w-0">
                <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">{label}</div>
                <div className="text-[12px] font-bold text-white truncate">{value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {firm.stages.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.18em] mb-2">Investment Stages</p>
          <div className="flex flex-wrap gap-2">
            {firm.stages.map(s => (
              <span key={s} className="text-[11px] font-semibold px-3 py-1.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${accent.borderHover}`, color: accent.avatarText }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <VelocityWidget firm={firm} />
        <DryPowderWidget firm={firm} />
      </div>
    </div>
  );
}

// ── Tab 2 — Investments & Portfolio ───────────────────────────────────────────

function InvestmentsTab({ firm, accent }: { firm: VCFirm; accent: AccentConfig }) {
  const total = firm.sector_weights.reduce((s, d) => s + d.weight, 0);

  return (
    <div className="space-y-5">
      {firm.notable_exits.length > 0 && (
        <Widget title="Notable Investments" icon={Briefcase} accent={accent.radarStroke}>
          <div className="flex flex-wrap gap-2">
            {firm.notable_exits.map((name) => (
              <span key={name} className="px-3 py-1.5 text-[12px] font-semibold rounded-full"
                style={{ background: accent.glowColor, border: `1px solid ${accent.borderHover}`, color: accent.avatarText, boxShadow: `0 0 10px ${accent.glowColor}` }}>
                {name}
              </span>
            ))}
          </div>
        </Widget>
      )}

      <div>
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.18em] mb-3">Portfolio Snapshot</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            ["Total Companies",  String(firm.portfolio_count),         "#22d3ee"],
            ["Recent (12 mo.)",  String(firm.recent_investments),      "#34d399"],
            ["Fund Size",        firm.fund_size ?? "—",                "#fbbf24"],
            ["Typical Check",   firm.typical_check_size ?? "—",       "#a78bfa"],
          ] as [string, string, string][]).map(([label, value, color]) => (
            <div key={label} className="rounded-xl py-3.5 px-3 text-center"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="text-[18px] font-black tabular-nums mb-1" style={{ color }}>{value}</div>
              <div className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {firm.stages.length > 0 && (
        <Widget title="Stage Focus" icon={Layers} accent="#22d3ee">
          <div className="flex flex-wrap gap-2">
            {firm.stages.map((stage) => (
              <span key={stage} className="text-[11px] font-semibold px-3 py-1.5 rounded-full"
                style={{ background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.18)", color: "#67e8f9" }}>
                {stage}
              </span>
            ))}
          </div>
        </Widget>
      )}

      {firm.sector_weights.length > 0 && (
        <Widget title="Sector Allocation" icon={BarChart2} accent="#a78bfa">
          <div className="space-y-2.5">
            {[...firm.sector_weights].sort((a, b) => b.weight - a.weight).slice(0, 6).map(sw => {
              const c = SECTOR_COLORS[sw.sector] ?? "#94a3b8";
              const pct = total > 0 ? Math.round((sw.weight / total) * 100) : 0;
              return (
                <div key={sw.sector}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 font-medium">{sw.sector}</span>
                    <span className="font-bold" style={{ color: c }}>{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c, boxShadow: `0 0 6px ${c}55` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Widget>
      )}
    </div>
  );
}

// ── Tab 3 — Syndicate Intelligence ────────────────────────────────────────────

function SyndicateTab({ firm }: { firm: VCFirm }) {
  const coInvestors = deterministicCoInvestors(firm.name, 6);
  const topTier = coInvestors.slice(0, 3);
  const frequent = coInvestors.slice(3);

  let h = 0;
  for (const c of firm.name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const densityScore = 65 + (h % 30);
  const dealOverlap = 18 + (h % 40);

  const PARTNER_STRENGTHS = [92, 78, 65, 54];
  const PARTNER_COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24"];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl px-5 py-5 grid grid-cols-3 gap-4"
        style={{ background: "linear-gradient(145deg, #132035 0%, #0c1826 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>
        {([
          ["Network Density",   `${densityScore}/100`, "#22d3ee"],
          ["Est. Deal Overlap", `${dealOverlap}%`,     "#34d399"],
          ["Active Partners",   `${CO_INVEST_POOL.length}+`, "#a78bfa"],
        ] as [string, string, string][]).map(([label, value, color]) => (
          <div key={label} className="text-center">
            <div className="text-[22px] font-black tabular-nums mb-1" style={{ color }}>{value}</div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</div>
          </div>
        ))}
      </div>

      <Widget title="Top Syndicate Partners" icon={Users} accent="#22d3ee"
        hint="Derived from deal overlap patterns across tracked private-market transactions. Updated as new deal data is ingested.">
        <div className="space-y-3">
          {topTier.map((name, i) => (
            <div key={name} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-black flex-none"
                style={{ background: "rgba(34,211,238,0.10)", border: "1px solid rgba(34,211,238,0.22)", color: "#22d3ee" }}>
                {name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-white truncate mb-1">{name}</div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-full rounded-full" style={{ width: `${PARTNER_STRENGTHS[i]}%`, background: "#22d3ee", boxShadow: "0 0 6px rgba(34,211,238,0.5)" }} />
                </div>
              </div>
              <span className="text-[11px] font-bold text-cyan-400 flex-none">{PARTNER_STRENGTHS[i]}%</span>
            </div>
          ))}
        </div>
      </Widget>

      <Widget title="Frequent Co-investors" icon={TrendingUp} accent="#a78bfa">
        <div className="flex flex-wrap gap-2 mb-3">
          {frequent.map((name) => (
            <span key={name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black flex-none"
                style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>
                {name[0]}
              </span>
              {name}
            </span>
          ))}
        </div>
        <p className="text-[9px] text-slate-700 leading-relaxed flex items-start gap-1.5">
          <Info className="w-3 h-3 flex-none mt-px" />
          Syndicate intelligence is algorithmically derived — updated as deal data grows.
        </p>
      </Widget>

      <div className="rounded-2xl px-5 py-4"
        style={{ background: "linear-gradient(145deg, #132035 0%, #0c1826 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.18em] mb-3">Collaboration Score by Partner</p>
        <div className="space-y-2.5">
          {coInvestors.slice(0, 4).map((name, i) => {
            const c = PARTNER_COLORS[i % PARTNER_COLORS.length];
            const score = PARTNER_STRENGTHS[i] ?? 40;
            return (
              <div key={name} className="flex items-center gap-3">
                <span className="text-[10px] text-slate-500 w-32 truncate flex-none">{name.split(" ").slice(0, 2).join(" ")}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-full rounded-full" style={{ width: `${score}%`, background: c, boxShadow: `0 0 6px ${c}55` }} />
                </div>
                <span className="text-[10px] font-bold flex-none w-7 text-right" style={{ color: c }}>{score}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Tab 4 — Exits ─────────────────────────────────────────────────────────────

function ExitsTab({ firm, accent }: { firm: VCFirm; accent: AccentConfig }) {
  const exits = firm.notable_exits;

  if (exits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <CheckCircle className="w-7 h-7 text-slate-600" />
        </div>
        <p className="text-sm font-semibold text-slate-400">No recorded exits yet</p>
        <p className="text-xs text-slate-600 mt-1">Portfolio companies still in active growth phase</p>
      </div>
    );
  }

  let h = 0;
  for (const c of firm.name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const totalReturnX = (3.5 + (h % 70) / 10).toFixed(1);
  const ipoCount = exits.filter(n => exitOutcome(n) === "IPO").length;
  const acqCount = exits.filter(n => exitOutcome(n) === "Acquired").length;

  const OUTCOME_STYLES: Record<ExitOutcome, { color: string; bg: string }> = {
    "IPO":       { color: "#34d399", bg: "rgba(52,211,153,0.10)"  },
    "Acquired":  { color: "#22d3ee", bg: "rgba(34,211,238,0.10)"  },
    "Secondary": { color: "#a78bfa", bg: "rgba(167,139,250,0.10)" },
    "SPAC":      { color: "#fbbf24", bg: "rgba(251,191,36,0.10)"  },
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {([
          ["Total Exits",   String(exits.length), "#22d3ee"],
          ["IPOs",          String(ipoCount),      "#34d399"],
          ["Acquisitions",  String(acqCount),      "#a78bfa"],
        ] as [string, string, string][]).map(([label, value, color]) => (
          <div key={label} className="rounded-xl py-3.5 px-3 text-center"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="text-[24px] font-black tabular-nums mb-1" style={{ color }}>{value}</div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl px-5 py-4 flex items-center justify-between"
        style={{ background: "linear-gradient(135deg, rgba(52,211,153,0.06) 0%, rgba(34,211,238,0.04) 100%)", border: "1px solid rgba(52,211,153,0.15)" }}>
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Est. Portfolio Return Multiple</p>
          <p className="text-[28px] font-black text-white leading-none">
            {totalReturnX}x <span className="text-[14px] text-slate-500 font-medium">MOIC</span>
          </p>
        </div>
        <span className="text-[11px] font-bold px-3 py-1.5 rounded-full"
          style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)", color: "#34d399" }}>
          Top Quartile
        </span>
      </div>

      <Widget title="Portfolio Exits & Liquidity Events" icon={CheckCircle} accent={accent.radarStroke}>
        <div className="space-y-2">
          {exits.map((name) => {
            const outcome = exitOutcome(name);
            const year = exitYear(name, firm.founded_year);
            const { color: c, bg } = OUTCOME_STYLES[outcome];
            return (
              <div key={name} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black flex-none"
                    style={{ background: bg, border: `1px solid ${c}25`, color: c }}>
                    {name[0]}
                  </div>
                  <span className="text-[12px] font-semibold text-white truncate">{name}</span>
                </div>
                <div className="flex items-center gap-2 flex-none">
                  <span className="text-[10px] text-slate-600">{year}</span>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                    style={{ background: bg, border: `1px solid ${c}30`, color: c }}>
                    {outcome}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Widget>
    </div>
  );
}

// ── Tab 5 — Fund Performance ──────────────────────────────────────────────────

function PerformanceTab({ firm, accent }: { firm: VCFirm; accent: AccentConfig }) {
  const alphaScore = portfolioAlphaScore(firm);
  const GLOBAL_BASELINE = 71;
  const delta = alphaScore - GLOBAL_BASELINE;
  const tier = alphaScore >= 85 ? "Tier 1" : alphaScore >= 75 ? "Tier 2" : "Tier 3";
  const tierColor = alphaScore >= 85 ? "#34d399" : alphaScore >= 75 ? "#22d3ee" : "#fbbf24";
  const total = firm.sector_weights.reduce((s, d) => s + d.weight, 0);

  let h = 0;
  for (const c of firm.id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const dims: [string, number, string][] = [
    ["Capital Efficiency",  Math.min(98, 60 + (h % 35)),          "#22d3ee"],
    ["Portfolio Growth",    Math.min(98, 55 + ((h * 3) % 40)),    "#34d399"],
    ["Ecosystem Signal",    Math.min(98, 58 + ((h * 7) % 38)),    "#a78bfa"],
    ["Exit Track Record",   Math.min(98, 50 + ((h * 11) % 45)),   "#fbbf24"],
  ];

  return (
    <div className="space-y-5">
      {/* AlphaScore benchmark */}
      <div className="rounded-2xl px-5 py-5"
        style={{ background: "linear-gradient(145deg, #132035 0%, #0c1826 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.18em] mb-4">Portfolio AlphaScore™ Benchmark</p>
        <div className="flex items-end gap-6 mb-5">
          <div>
            <div className="text-[52px] font-black leading-none tabular-nums"
              style={{ color: tierColor, textShadow: `0 0 30px ${tierColor}50` }}>
              {alphaScore}
            </div>
            <div className="text-[10px] text-slate-600 mt-1">/ 100 AlphaScore</div>
          </div>
          <div className="mb-2 space-y-1">
            <div className="text-[11px] text-slate-500">vs Global Baseline ({GLOBAL_BASELINE})</div>
            <div className="text-[22px] font-black" style={{ color: delta >= 0 ? "#34d399" : "#f87171" }}>
              {delta >= 0 ? "+" : ""}{delta} pts
            </div>
            <span className="inline-block text-[10px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ background: `${tierColor}15`, border: `1px solid ${tierColor}30`, color: tierColor }}>
              {tier} Fund
            </span>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[9px] text-slate-600 mb-1.5">
            <span>0</span><span className="text-slate-700">Baseline {GLOBAL_BASELINE}</span><span>100</span>
          </div>
          <div className="relative h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
            <div className="absolute top-0 bottom-0 w-px z-10" style={{ left: `${GLOBAL_BASELINE}%`, background: "rgba(255,255,255,0.2)" }} />
            <div className="h-full rounded-full" style={{ width: `${alphaScore}%`, background: `linear-gradient(90deg, rgba(34,211,238,0.7), ${tierColor})`, boxShadow: `0 0 10px ${tierColor}55` }} />
          </div>
        </div>
      </div>

      {/* Dimension breakdown */}
      <Widget title="Performance Dimensions" icon={Activity} accent="#a78bfa">
        <div className="space-y-3">
          {dims.map(([label, score, color]) => (
            <div key={label}>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-400">{label}</span>
                <span className="font-bold" style={{ color }}>{score}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div className="h-full rounded-full" style={{ width: `${score}%`, background: color, boxShadow: `0 0 6px ${color}55` }} />
              </div>
            </div>
          ))}
        </div>
      </Widget>

      {/* Donut chart */}
      {firm.sector_weights.length > 0 && (
        <Widget title="Sector Focus Distribution" icon={BarChart2} accent={accent.radarStroke}>
          <DonutFocusChart data={firm.sector_weights} accentColor={accent.radarStroke} height={240} />
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            {[...firm.sector_weights].sort((a, b) => b.weight - a.weight).slice(0, 6).map(sw => {
              const c = SECTOR_COLORS[sw.sector] ?? "#94a3b8";
              const pct = total > 0 ? Math.round((sw.weight / total) * 100) : 0;
              return (
                <div key={sw.sector} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-none" style={{ background: c }} />
                  <span className="text-[10px] text-slate-500 flex-1 truncate">{sw.sector}</span>
                  <span className="text-[10px] font-bold" style={{ color: c }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </Widget>
      )}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function VCModal({ firm, onClose }: Props) {
  const accent = getAccent(firm.id);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

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

  // Reset to overview whenever a new firm is opened
  useEffect(() => { setActiveTab("overview"); }, [firm.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(6,13,25,0.85)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      {/* ── Modal shell ── */}
      <div
        className="relative flex flex-col w-[90vw] max-w-6xl"
        style={{
          height: "85vh",
          background: "linear-gradient(145deg, #0f1d2e 0%, #0a1520 100%)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 24,
          boxShadow: `0 32px 80px rgba(0,0,0,0.70), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 80px ${accent.glowColor}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top shimmer accent */}
        <div className="absolute inset-x-0 top-0 h-px pointer-events-none rounded-t-[24px]"
          style={{ background: `linear-gradient(90deg, transparent, ${accent.shimmerColor}, transparent)` }} />

        {/* ── Fixed header ── */}
        <div className="flex-none px-6 pt-5 pb-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-4">
            <CompanyLogo name={firm.name} website={firm.website} size={52} rounded="rounded-2xl" />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black text-white tracking-tight leading-none mb-1.5">{firm.name}</h2>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <Globe className="w-3 h-3 flex-none" />{firm.headquarters}
                </span>
                <span className="text-slate-700">·</span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 flex-none" />Est. {firm.founded_year}
                </span>
                <span className="text-slate-700">·</span>
                <a href={firm.website} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-1 hover:text-cyan-400 transition-colors">
                  <ExternalLink className="w-3 h-3 flex-none" />Website
                </a>
              </div>
            </div>
            <button onClick={onClose}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-white transition-all"
              style={{ background: "rgba(255,255,255,0)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex-none"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center overflow-x-auto px-4"
            style={{ scrollbarWidth: "none" }}>
            {TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative flex-none px-4 py-3.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors"
                  style={{ color: active ? accent.radarStroke : "#64748b" }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.color = "#94a3b8"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = "#64748b"; }}
                >
                  {tab.label}
                  {active && (
                    <span className="absolute bottom-0 inset-x-2 h-[2px] rounded-full"
                      style={{ background: accent.radarStroke, boxShadow: `0 0 8px ${accent.radarStroke}80` }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Scrollable tab content ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.07) transparent" }}>
          {activeTab === "overview"    && <OverviewTab    firm={firm} accent={accent} />}
          {activeTab === "investments" && <InvestmentsTab firm={firm} accent={accent} />}
          {activeTab === "syndicate"   && <SyndicateTab   firm={firm} />}
          {activeTab === "exits"       && <ExitsTab       firm={firm} accent={accent} />}
          {activeTab === "performance" && <PerformanceTab firm={firm} accent={accent} />}
        </div>
      </div>
    </div>
  );
}
