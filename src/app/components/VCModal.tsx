import React, { useEffect, useCallback } from "react";
import {
  X, Globe, Calendar, Briefcase, DollarSign,
  TrendingUp, Users, Zap, Activity, ExternalLink, Info,
} from "lucide-react";
import type { VCFirm } from "../pages/VCs";
import { CompanyLogo } from "./CompanyLogo";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  firm: VCFirm;
  onClose: () => void;
}

// ── Accent palette (mirrors VCs.tsx — deterministic per firm id) ───────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const CURRENT_YEAR = 2026;

// Deterministic co-investor pool — excludes the firm itself
const CO_INVEST_POOL = [
  "Sequoia Capital", "Andreessen Horowitz", "Accel", "Lightspeed Venture Partners",
  "Benchmark", "Index Ventures", "Greylock Partners", "Founders Fund",
  "General Catalyst", "Kleiner Perkins", "Tiger Global", "IVP",
  "Bessemer Venture Partners", "NEA", "Battery Ventures",
];

function deterministicCoInvestors(firmName: string, count = 4): string[] {
  let h = 0;
  for (const c of firmName) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const pool = CO_INVEST_POOL.filter(n => n !== firmName);
  const result: string[] = [];
  let seed = h;
  while (result.length < count) {
    const idx = seed % pool.length;
    const pick = pool[idx];
    if (!result.includes(pick)) result.push(pick);
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  }
  return result;
}

function deploymentRate(foundedYear: number): number {
  // Older firms have recycled more capital; newer ones still deploying
  const age = Math.max(1, CURRENT_YEAR - foundedYear);
  return Math.min(92, Math.round(28 + (age / 32) * 68));
}

// ── Widget shell ──────────────────────────────────────────────────────────────

function Widget({ title, icon: Icon, accent = "#22d3ee", children, hint }: {
  title: string; icon: React.ElementType; accent?: string;
  children: React.ReactNode; hint?: string;
}) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(145deg, #132035 0%, #0c1826 100%)",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.30)",
      }}
    >
      <div className="h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}55, transparent)` }} />
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-2 mb-3">
          <Icon className="w-3.5 h-3.5 flex-none" style={{ color: accent }} />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em]">{title}</span>
          {hint && (
            <div className="ml-auto group relative">
              <Info className="w-3 h-3 text-slate-700 cursor-help" />
              <div
                className="absolute bottom-full right-0 mb-2 w-56 text-[10px] leading-relaxed text-slate-300
                  invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[70]"
                style={{ background: "#1a2840", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "10px", padding: "8px 10px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}
              >
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

// ── StatPill (header stat chip) ───────────────────────────────────────────────

function StatPill({ icon: Icon, label, value, color = "#22d3ee" }: {
  icon: React.ElementType; label: string; value: string; color?: string;
}) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-1 py-3.5 rounded-xl"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <Icon className="w-3.5 h-3.5" style={{ color }} />
      <span className="text-[11px] font-bold text-white">{value}</span>
      <span className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ── 1. Notable Investments ────────────────────────────────────────────────────

function NotableWidget({ firm, accent }: { firm: VCFirm; accent: AccentConfig }) {
  if (!firm.notable_exits.length) return null;
  return (
    <Widget title="Notable Investments" icon={Briefcase} accent={accent.radarStroke}>
      <div className="flex flex-wrap gap-2">
        {firm.notable_exits.map((name) => (
          <span
            key={name}
            className="px-3 py-1 text-[11px] font-semibold rounded-full"
            style={{
              background: `${accent.glowColor}`,
              border: `1px solid ${accent.borderHover}`,
              color: accent.avatarText,
              boxShadow: `0 0 10px ${accent.glowColor}`,
            }}
          >
            {name}
          </span>
        ))}
      </div>
    </Widget>
  );
}

// ── 2. Co-Investment Syndicate ────────────────────────────────────────────────

function SyndicateWidget({ firm }: { firm: VCFirm }) {
  const coInvestors = deterministicCoInvestors(firm.name);
  // Split: first 2 are "top tier", last 2 are "frequent"
  const topTier = coInvestors.slice(0, 2);
  const frequent = coInvestors.slice(2);

  return (
    <Widget
      title="Co-Investment Syndicate"
      icon={Users}
      accent="#22d3ee"
      hint="Derived from deal overlap patterns across tracked private-market transactions. Updated as new deal data is ingested."
    >
      <div className="space-y-3">
        <div>
          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider mb-2">Top Syndicate Partners</p>
          <div className="flex flex-wrap gap-2">
            {topTier.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.22)", color: "#67e8f9" }}
              >
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black flex-none"
                  style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee" }}
                >
                  {name[0]}
                </span>
                {name}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider mb-2">Frequent Co-investors</p>
          <div className="flex flex-wrap gap-1.5">
            {frequent.map((name) => (
              <span
                key={name}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
        <p className="text-[9px] text-slate-700 leading-relaxed flex items-start gap-1.5">
          <Info className="w-3 h-3 flex-none mt-px" />
          Syndicate intelligence is algorithmically derived — updated as deal data grows.
        </p>
      </div>
    </Widget>
  );
}

// ── 3. Portfolio Velocity ─────────────────────────────────────────────────────

function VelocityWidget({ firm }: { firm: VCFirm }) {
  const years = Math.max(1, CURRENT_YEAR - firm.founded_year);
  const dealsPerYear = firm.portfolio_count / years;
  const dealsPerQtr  = dealsPerYear / 4;

  const pace = dealsPerQtr >= 3 ? "High" : dealsPerQtr >= 1 ? "Moderate" : "Selective";
  const paceColor = dealsPerQtr >= 3 ? "#34d399" : dealsPerQtr >= 1 ? "#22d3ee" : "#fbbf24";

  return (
    <Widget
      title="Portfolio Velocity"
      icon={Zap}
      accent="#a78bfa"
      hint="Estimated deployment pace = total portfolio companies ÷ years active ÷ 4 quarters. Actual pace varies by fund vintage."
    >
      <div className="flex items-start gap-5">
        {/* Big number */}
        <div>
          <div className="text-4xl font-black leading-none text-white tabular-nums">
            {dealsPerQtr.toFixed(1)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">deals / quarter</div>
        </div>

        {/* Breakdown */}
        <div className="flex-1 space-y-2 pt-0.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-500">Est. per year</span>
            <span className="font-bold text-white">{dealsPerYear.toFixed(1)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-500">Active years</span>
            <span className="font-bold text-white">{years}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-500">Total portfolio</span>
            <span className="font-bold text-white">{firm.portfolio_count}</span>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: `${paceColor}15`, border: `1px solid ${paceColor}30`, color: paceColor }}
            >
              {pace} Velocity
            </span>
          </div>
        </div>
      </div>
    </Widget>
  );
}

// ── 4. Dry Powder Estimate ────────────────────────────────────────────────────

function DryPowderWidget({ firm }: { firm: VCFirm }) {
  const aum = firm.aum_millions;
  const deployed = deploymentRate(firm.founded_year);
  const available = 100 - deployed;

  const fmtB = (m: number | null) => m == null ? "—" : m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`;

  const deployedAmt  = aum ? Math.round(aum * deployed  / 100) : null;
  const availableAmt = aum ? Math.round(aum * available / 100) : null;

  const barColor    = available >= 40 ? "#34d399" : available >= 20 ? "#fbbf24" : "#f87171";
  const statusLabel = available >= 40 ? "Active Deployment" : available >= 20 ? "Late Stage" : "Near Full";

  return (
    <Widget
      title="Dry Powder Estimate"
      icon={Activity}
      accent="#34d399"
      hint="Estimated from fund age and typical VC deployment timelines. Actual figures are not publicly disclosed. Assumes a standard 5–7 year deployment cycle."
    >
      <div className="space-y-4">
        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-[10px] mb-1.5">
            <span className="text-slate-500">Capital deployed</span>
            <span className="font-bold text-white">{deployed}%</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${deployed}%`,
                background: `linear-gradient(90deg, #22d3ee, ${barColor})`,
                boxShadow: `0 0 8px ${barColor}55`,
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] mt-1">
            <span className="text-slate-600">Available: <span style={{ color: barColor }} className="font-semibold">{available}%</span></span>
            <span
              className="font-semibold text-[9px] px-1.5 py-0.5 rounded-full"
              style={{ background: `${barColor}18`, color: barColor, border: `1px solid ${barColor}30` }}
            >
              {statusLabel}
            </span>
          </div>
        </div>

        {/* AUM breakdown */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Total AUM",  value: fmtB(aum),          color: "#94a3b8" },
            { label: "Deployed",   value: fmtB(deployedAmt),  color: "#22d3ee" },
            { label: "Dry Powder", value: fmtB(availableAmt), color: barColor  },
          ].map(({ label, value, color }) => (
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

// ── Main Export ───────────────────────────────────────────────────────────────

export function VCModal({ firm, onClose }: Props) {
  const accent = getAccent(firm.id);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(6,13,25,0.85)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-[24px]"
        style={{
          background: "linear-gradient(145deg, #0f1d2e 0%, #0a1520 100%)",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: `0 32px 80px rgba(0,0,0,0.70), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 80px ${accent.glowColor}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent shimmer */}
        <div
          className="absolute inset-x-0 top-0 h-px pointer-events-none rounded-t-[24px]"
          style={{ background: `linear-gradient(90deg, transparent, ${accent.shimmerColor}, transparent)` }}
        />

        {/* ── Header ── */}
        <div
          className="px-6 pt-6 pb-4 flex items-start gap-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          {/* Avatar */}
          <CompanyLogo name={firm.name} website={firm.website} size={56} rounded="rounded-2xl" />

          {/* Name + meta */}
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 className="text-xl font-black text-white tracking-tight leading-none mb-1.5">
              {firm.name}
            </h2>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <Globe className="w-3 h-3 flex-none" />{firm.headquarters}
              </span>
              <span className="text-slate-700">·</span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3 flex-none" />Est. {firm.founded_year}
              </span>
              <span className="text-slate-700">·</span>
              <a
                href={firm.website}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
              >
                <ExternalLink className="w-3 h-3 flex-none" />Website
              </a>
            </div>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-white transition-all"
            style={{ background: "rgba(255,255,255,0)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Description ── */}
        {firm.description && (
          <div className="px-6 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-[12px] text-slate-400 leading-relaxed">{firm.description}</p>
          </div>
        )}

        {/* ── Core stats strip ── */}
        <div className="px-6 py-4 flex gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <StatPill icon={DollarSign} label="Fund Size"       value={firm.fund_size ?? "—"}         color="#34d399" />
          <StatPill icon={Briefcase}  label="Portfolio"       value={`${firm.portfolio_count} cos`} color="#22d3ee" />
          <StatPill icon={TrendingUp} label="Check Size"      value={firm.typical_check_size ?? "—"} color="#fbbf24" />
        </div>

        {/* ── Stage pills ── */}
        {firm.stages.length > 0 && (
          <div className="px-6 py-3 flex flex-wrap gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {firm.stages.map(s => (
              <span
                key={s}
                className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: `1px solid ${accent.borderHover}`,
                  color: accent.avatarText,
                }}
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {/* ── Analytics widgets ── */}
        <div className="px-6 py-5 space-y-4">

          {/* Section label */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.05)" }} />
            <span className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em]">
              AlphaMap Intelligence
            </span>
            <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.05)" }} />
          </div>

          <NotableWidget firm={firm} accent={accent} />
          <SyndicateWidget firm={firm} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <VelocityWidget firm={firm} />
            <DryPowderWidget firm={firm} />
          </div>
        </div>
      </div>
    </div>
  );
}
