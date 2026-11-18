import React, { useEffect, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { stageLabel, sectorLabel } from "../../lib/taxonomy";
import {
  X, Globe, Calendar, Briefcase, DollarSign, TrendingUp, Users, Zap,
  Activity, ExternalLink, Info, BarChart2, Award, Layers, CheckCircle, MapPin,
} from "lucide-react";
import type { VCFirm } from "../pages/VCs";
import { CompanyLogo } from "./CompanyLogo";
import { DonutFocusChart } from "./DonutFocusChart";
import { cleanNarrative } from "../../../lib/enrichment/narrative";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  firm: VCFirm;
  onClose: () => void;
}

// ── Tab system ────────────────────────────────────────────────────────────────

type TabId = "overview" | "investments";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview",     label: "Overview"              },
  { id: "investments",  label: "Investments"           },
];

// ── Accent palette ────────────────────────────────────────────────────────────
// radarStroke/shimmerColor/glowColor/borderHover stay vivid — used for icons,
// progress-bar fills, underlines, and glows, which read fine at full
// saturation against a white card. textOnLight is the same hue darkened to a
// -700-ish shade, used anywhere the color sits behind actual readable text.

interface AccentConfig {
  radarStroke: string; shimmerColor: string;
  glowColor: string;   borderHover: string;
  avatarFrom: string;  avatarTo: string; avatarText: string;
  textOnLight: string;
}

const ACCENT_PALETTE: AccentConfig[] = [
  { radarStroke: '#22d3ee', shimmerColor: 'rgba(34,211,238,0.35)',  glowColor: 'rgba(34,211,238,0.10)',  borderHover: 'rgba(34,211,238,0.22)',  avatarFrom: '#0e4f5e', avatarTo: '#0a3040', avatarText: '#67e8f9', textOnLight: '#0e7490' },
  { radarStroke: '#a78bfa', shimmerColor: 'rgba(167,139,250,0.35)', glowColor: 'rgba(139,92,246,0.10)',  borderHover: 'rgba(167,139,250,0.22)', avatarFrom: '#3b1f72', avatarTo: '#1e1040', avatarText: '#c4b5fd', textOnLight: '#6d28d9' },
  { radarStroke: '#34d399', shimmerColor: 'rgba(52,211,153,0.35)',  glowColor: 'rgba(16,185,129,0.10)',  borderHover: 'rgba(52,211,153,0.22)',  avatarFrom: '#064e33', avatarTo: '#042a1c', avatarText: '#6ee7b7', textOnLight: '#047857' },
  { radarStroke: '#fbbf24', shimmerColor: 'rgba(251,191,36,0.35)',  glowColor: 'rgba(245,158,11,0.10)',  borderHover: 'rgba(251,191,36,0.22)',  avatarFrom: '#5c3d0a', avatarTo: '#2d1d04', avatarText: '#fcd34d', textOnLight: '#b45309' },
  { radarStroke: '#f472b6', shimmerColor: 'rgba(244,114,182,0.35)', glowColor: 'rgba(236,72,153,0.10)',  borderHover: 'rgba(244,114,182,0.22)', avatarFrom: '#5c0a2d', avatarTo: '#2d0414', avatarText: '#f9a8d4', textOnLight: '#be185d' },
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
// Darkened equivalents for when a sector color sits behind small text
const SECTOR_TEXT_COLORS: Record<string, string> = {
  AI: "#0e7490", FinTech: "#6d28d9", Cyber: "#047857",
  SaaS: "#1d4ed8", HealthTech: "#be185d", FoodTech: "#b45309",
};

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
    <div className="rounded-lg overflow-hidden bg-white"
      style={{ border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)" }}>
      <div className="h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}55, transparent)` }} />
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-2 mb-3">
          <Icon className="w-3.5 h-3.5 flex-none" style={{ color: accent }} />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.12em]">{title}</span>
          {hint && (
            <div className="ml-auto group relative">
              <Info className="w-3 h-3 text-gray-300 cursor-help" />
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

// ── Tab 1 — Overview ──────────────────────────────────────────────────────────

function OverviewTab({ firm, accent }: { firm: VCFirm; accent: AccentConfig }) {
  const { t } = useTranslation();
  const vitals: [React.ElementType, string, string, string][] = [
    [DollarSign, "Fund AUM",     fmtB(firm.aum_millions),            "#047857"],
    [MapPin,     "Headquarters", firm.headquarters,                   "#0e7490"],
    [Calendar,   "Founded",      firm.founded_year ? String(firm.founded_year) : "—", "#6d28d9"],
    [TrendingUp, "Check Size",   firm.typical_check_size ?? "—",     "#b45309"],
    [Briefcase,  "Portfolio",    `${firm.portfolio_count} companies`, "#0e7490"],
    [Award,      "Stage Focus",  firm.stages.slice(0, 2).join(", ") || "—", "#be185d"],
  ];

  return (
    <div className="space-y-5">
      {cleanNarrative(firm.description) && (
        <div className="rounded-lg px-5 py-4 bg-gray-50 border border-gray-100">
          <p className="text-[13px] text-gray-700 leading-relaxed">{cleanNarrative(firm.description)}</p>
        </div>
      )}

      <div>
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-3">{t("vcModal.firmVitals")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {vitals.map(([Icon, label, value, color]) => (
            <div key={label} className="flex items-center gap-3 rounded-lg px-3.5 py-3 bg-gray-50 border border-gray-100">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-none"
                style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
                <Icon className="w-3.5 h-3.5" style={{ color }} />
              </div>
              <div className="min-w-0">
                <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-0.5">{label}</div>
                <div className="text-[12px] font-bold text-gray-900 truncate">{value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {firm.stages.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-2">{t("vcs.investmentStages")}</p>
          <div className="flex flex-wrap gap-2">
            {firm.stages.map(s => (
              <span key={s} className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-gray-50"
                style={{ border: `1px solid ${accent.borderHover}`, color: accent.textOnLight }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Tab 2 — Investments & Portfolio ───────────────────────────────────────────

function InvestmentsTab({ firm, accent }: { firm: VCFirm; accent: AccentConfig }) {
  const { t } = useTranslation();
  const total = firm.sector_weights.reduce((s, d) => s + d.weight, 0);

  return (
    <div className="space-y-5">
      {firm.notable_exits.length > 0 && (
        <Widget title="Notable Investments" icon={Briefcase} accent={accent.radarStroke}>
          <div className="flex flex-wrap gap-2">
            {firm.notable_exits.map((name) => (
              <span key={name} className="px-3 py-1.5 text-[12px] font-semibold rounded-full"
                style={{ background: `${accent.textOnLight}10`, border: `1px solid ${accent.borderHover}`, color: accent.textOnLight }}>
                {name}
              </span>
            ))}
          </div>
        </Widget>
      )}

      <div>
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.18em] mb-3">{t("vcModal.portfolioSnapshot")}</p>
        <div className="grid grid-cols-3 gap-3">
          {([
            ["Total Companies",  String(firm.portfolio_count),         "#0e7490"],
            ["Fund Size",        firm.fund_size ?? "—",                "#b45309"],
            ["Typical Check",   firm.typical_check_size ?? "—",       "#6d28d9"],
          ] as [string, string, string][]).map(([label, value, color]) => (
            <div key={label} className="rounded-lg py-3.5 px-3 text-center bg-gray-50 border border-gray-100">
              <div className="text-[18px] font-black tabular-nums mb-1" style={{ color }}>{value}</div>
              <div className="text-[9px] text-gray-400 uppercase tracking-wider">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {firm.stages.length > 0 && (
        <Widget title="Stage Focus" icon={Layers} accent="#22d3ee">
          <div className="flex flex-wrap gap-2">
            {firm.stages.map((stage) => (
              <span key={stage} className="text-[11px] font-semibold px-3 py-1.5 rounded-full"
                style={{ background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.20)", color: "#0e7490" }}>
                {stageLabel(stage, t)}
              </span>
            ))}
          </div>
        </Widget>
      )}

      {firm.sector_weights.length > 0 && (
        <Widget title="Sector Allocation" icon={BarChart2} accent="#a78bfa">
          <div className="space-y-2.5">
            {[...firm.sector_weights].sort((a, b) => b.weight - a.weight).slice(0, 6).map(sw => {
              const barColor = SECTOR_COLORS[sw.sector] ?? "#94a3b8";
              const textColor = SECTOR_TEXT_COLORS[sw.sector] ?? "#475569";
              const pct = total > 0 ? Math.round((sw.weight / total) * 100) : 0;
              return (
                <div key={sw.sector}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-gray-600 font-medium">{sw.sector}</span>
                    <span className="font-bold" style={{ color: textColor }}>{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-gray-100">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
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

// ── Main Export ───────────────────────────────────────────────────────────────

export function VCModal({ firm, onClose }: Props) {
  const { t } = useTranslation();
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
      style={{ background: "rgba(6,13,25,0.55)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      {/* ── Modal shell ── */}
      <div
        className="relative flex flex-col w-[90vw] max-w-6xl bg-white"
        style={{
          height: "85vh",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 32px 80px rgba(15,23,42,0.35), 0 0 0 1px rgba(15,23,42,0.02)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Fixed header (blue-gray) ── */}
        <div className="flex-none px-6 pt-5 pb-4 rounded-t-[10px]"
          style={{ background: "#B8C9D1", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
          <div className="flex items-center gap-4">
            <CompanyLogo name={firm.name} website={firm.website} size={52} rounded="rounded-lg" />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black text-[#0F172A] tracking-tight leading-none mb-1.5">{firm.name}</h2>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#0F172A]/60">
                <span className="flex items-center gap-1">
                  <Globe className="w-3 h-3 flex-none" />{firm.headquarters}
                </span>
                <span className="text-[#0F172A]/30">·</span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 flex-none" />Est. {firm.founded_year}
                </span>
                <span className="text-[#0F172A]/30">·</span>
                <a href={firm.website} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-1 hover:text-cyan-700 transition-colors">
                  <ExternalLink className="w-3 h-3 flex-none" />{t("common.website")}</a>
              </div>
            </div>
            <button onClick={onClose}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#0F172A]/50 hover:text-[#0F172A] transition-all"
              style={{ background: "rgba(255,255,255,0)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.35)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Tab bar (same blue-gray, slightly deeper to read as one region) ── */}
        <div className="flex-none" style={{ background: "#AFC2CB", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
          <div className="flex items-center overflow-x-auto px-4"
            style={{ scrollbarWidth: "none" }}>
            {TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative flex-none px-4 py-3.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors"
                  style={{ color: active ? "#0F172A" : "rgba(15,23,42,0.55)" }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.color = "rgba(15,23,42,0.8)"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = "rgba(15,23,42,0.55)"; }}
                >
                  {tab.label}
                  {active && (
                    <span className="absolute bottom-0 inset-x-2 h-[2px] rounded-full"
                      style={{ background: "#0F172A" }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Scrollable tab content (white) ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-white"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(15,23,42,0.15) transparent" }}>
          {activeTab === "overview"    && <OverviewTab    firm={firm} accent={accent} />}
          {activeTab === "investments" && <InvestmentsTab firm={firm} accent={accent} />}
        </div>
      </div>
    </div>
  );
}
