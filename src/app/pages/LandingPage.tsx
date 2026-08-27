import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, Sparkles, TrendingUp, Loader2, Search, ArrowLeft,
  Building2, MousePointer2, MousePointerClick,
  Linkedin, Instagram,
} from "lucide-react";
import {
  SiAnthropic, SiDatabricks, SiStripe, SiPerplexity, SiBrex, SiNotion, SiDiscord, SiMiro,
  SiHuggingface, SiKlarna, SiRetool, SiLinear, SiVercel, SiZapier, SiWebflow, SiCoda, SiRevolut,
} from "react-icons/si";
import type { IconType } from "react-icons";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BrandMark, BrandWordmark } from "../components/BrandMark";
import { LanguageSelector } from "../components/LanguageSelector";
import { stageLabel, sectorLabel } from "../../lib/taxonomy";
import { homePathNow } from "../../lib/navHome";

// ── Shared dark section (CTA + footer) ───────────────────────────────────────
const DARK_SECTION_BG = "#242322";
const FOOTER_LINK_KEYS = ["about", "privacy", "terms", "contact"] as const;
const FOOTER_LINK_PATHS: Record<(typeof FOOTER_LINK_KEYS)[number], string> = {
  about: "/about",
  privacy: "/privacy",
  terms: "/terms",
  contact: "/contact",
};

// ── Hero typewriter copy ─────────────────────────────────────────────────────
// The headline text itself now comes from the active dictionary — the
// typewriter measures whatever string that resolves to, so CJK reveals one
// character at a time exactly as the Latin copy does.
const TYPE_START_DELAY_MS = 400;
const TYPE_SPEED_MS       = 85;
const SUBHEAD_PAUSE_MS    = 350; // pause after the headline finishes, before the subheading starts typing

// ── Product showcase (illustrative mock data + a hand-rolled smooth chart) ──
const STAGE_STYLES: Record<string, string> = {
  "Pre-Seed": "bg-gray-100 border-gray-200 text-gray-600",
  "Seed":     "bg-emerald-50 border-emerald-200 text-emerald-700",
  "Series A": "bg-blue-50 border-blue-200 text-blue-700",
  "Series B": "bg-violet-50 border-violet-200 text-violet-700",
  "Series C": "bg-violet-50 border-violet-200 text-violet-700",
  "Series D": "bg-cyan-50 border-cyan-200 text-cyan-700",
  "Series E": "bg-cyan-50 border-cyan-200 text-cyan-700",
  "Series F": "bg-rose-50 border-rose-200 text-rose-700",
  "Series G": "bg-rose-50 border-rose-200 text-rose-700",
  "Series K": "bg-rose-50 border-rose-200 text-rose-700",
  "Growth":   "bg-amber-50 border-amber-200 text-amber-700",
  "Tender":   "bg-gray-100 border-gray-200 text-gray-600",
};

const SHOWCASE_TABS: { key: string; labelKey: string }[] = [
  { key: "sourcing", labelKey: "landing.tabs.sourcing" },
  { key: "startups", labelKey: "landing.tabs.startups" },
  { key: "vcs",      labelKey: "landing.tabs.vcs" },
  { key: "deals",    labelKey: "landing.tabs.deals" },
];

// Shared brand mark per real company — official Simple Icons logo + brand color.
// Companies below were deliberately chosen from the set that has a real,
// precise mark available (react-icons/si) rather than approximated.
const COMPANY_META: Record<string, { icon: IconType; color: string }> = {
  "Anthropic":    { icon: SiAnthropic,   color: "#191919" },
  "Databricks":   { icon: SiDatabricks,  color: "#FF3621" },
  "Stripe":       { icon: SiStripe,      color: "#635BFF" },
  "Perplexity":   { icon: SiPerplexity,  color: "#1FB8CD" },
  "Brex":         { icon: SiBrex,        color: "#212121" },
  "Notion":       { icon: SiNotion,      color: "#000000" },
  "Discord":      { icon: SiDiscord,     color: "#5865F2" },
  "Miro":         { icon: SiMiro,        color: "#050038" },
  "Hugging Face": { icon: SiHuggingface, color: "#FFD21E" },
  "Klarna":       { icon: SiKlarna,      color: "#FFB3C7" },
  "Retool":       { icon: SiRetool,      color: "#3D3D3D" },
  "Linear":       { icon: SiLinear,      color: "#5E6AD2" },
  "Vercel":       { icon: SiVercel,      color: "#000000" },
  "Zapier":       { icon: SiZapier,      color: "#FF4F00" },
  "Webflow":      { icon: SiWebflow,     color: "#146EF5" },
  "Coda":         { icon: SiCoda,        color: "#F46A54" },
  "Revolut":      { icon: SiRevolut,     color: "#191C1F" },
};

// Auto-contrast so pale brand colors (e.g. Klarna pink, Hugging Face yellow)
// still read clearly instead of washing out a white glyph.
function iconContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111827" : "#FFFFFF";
}

function CompanyLogo({ company, size = 28 }: { company: string; size?: number }) {
  const meta = COMPANY_META[company];
  if (!meta) {
    return (
      <div className="rounded-lg flex items-center justify-center bg-gray-400 text-white flex-none" style={{ width: size, height: size }}>
        <Building2 style={{ width: size * 0.55, height: size * 0.55 }} />
      </div>
    );
  }
  const Icon = meta.icon;
  return (
    <div
      className="rounded-lg flex items-center justify-center flex-none"
      style={{ background: meta.color, width: size, height: size }}
    >
      <Icon size={size * 0.55} color={iconContrastColor(meta.color)} />
    </div>
  );
}

const DEAL_ROWS = [
  { company: "Databricks",   type: "Series K", size: "$1B",   leads: "Thrive Capital",         valuation: "$62B",   estimated: false, pulse: true  },
  { company: "Stripe",       type: "Tender",   size: "$700M", leads: "Goldman Sachs, Thrive",  valuation: "$91.5B", estimated: false, pulse: false },
  { company: "Perplexity",   type: "Series D", size: "$500M", leads: "IVP",                    valuation: "$18B",   estimated: true,  pulse: false },
  { company: "Brex",         type: "Series D", size: "$300M", leads: "Greenoaks",              valuation: "$12.3B", estimated: false, pulse: true  },
  { company: "Notion",       type: "Series C", size: "$343M", leads: "Coatue",                 valuation: "$10.2B", estimated: true,  pulse: false },
  { company: "Discord",      type: "Series H", size: "$500M", leads: "Tencent, Various",       valuation: "$15B",   estimated: true,  pulse: true  },
  { company: "Miro",         type: "Series C", size: "$400M", leads: "ICONIQ Growth",          valuation: "$17.5B", estimated: false, pulse: false },
  { company: "Hugging Face", type: "Series D", size: "$235M", leads: "Salesforce Ventures",    valuation: "$4.5B",  estimated: false, pulse: true  },
];

const SOURCING_ROWS = [
  { company: "Linear",  match: 96, momentum: 92, sector: "Dev Tools",   tag2: "Project Mgmt", stage: "Series B" },
  { company: "Vercel",  match: 93, momentum: 88, sector: "Dev Tools",   tag2: "Infra",         stage: "Series D" },
  { company: "Zapier",  match: 90, momentum: 84, sector: "Automation",  tag2: "No-Code",       stage: "Series C" },
  { company: "Webflow", match: 87, momentum: 81, sector: "No-Code",     tag2: "Design",        stage: "Series C" },
  { company: "Coda",    match: 84, momentum: 77, sector: "Productivity", tag2: "Docs",         stage: "Series D" },
];

const VC_FUNDS = [
  {
    key: "sequoia", name: "Sequoia Capital", stages: ["Seed", "Series A", "Growth"], aum: "$85B", portfolio: 400, pulse: true,
    investments: [
      { company: "Stripe",  round: "Tender Offer", amount: "$6.5B",  estimated: true  },
      { company: "Klarna",  round: "Series H",      amount: "$800M", estimated: true  },
      { company: "Notion",  round: "Series C",      amount: "$343M", estimated: false },
      { company: "Retool",  round: "Series C",      amount: "$45M",  estimated: true  },
    ],
  },
  {
    key: "a16z", name: "Andreessen Horowitz", stages: ["Series A", "Series B"], aum: "$45B", portfolio: 350, pulse: false,
    investments: [
      { company: "Databricks", round: "Series K", amount: "$250M", estimated: true  },
      { company: "Discord",    round: "Series H", amount: "$180M", estimated: true  },
      { company: "Brex",       round: "Series D", amount: "$120M", estimated: false },
      { company: "Perplexity", round: "Series D", amount: "$150M", estimated: true  },
    ],
  },
  {
    key: "index", name: "Index Ventures", stages: ["Seed", "Series B"], aum: "$20B", portfolio: 280, pulse: false,
    investments: [
      { company: "Miro",         round: "Series C", amount: "$90M", estimated: true  },
      { company: "Hugging Face", round: "Series D", amount: "$60M", estimated: true  },
      { company: "Revolut",      round: "Growth",   amount: "$75M", estimated: false },
      { company: "Webflow",      round: "Series C", amount: "$45M", estimated: true  },
    ],
  },
];

const VALUATION_TREND = [22, 19, 27, 33, 29, 41, 47, 43, 57, 64, 71, 88];
const CHART_W = 600;
const CHART_H = 200;
const CHART_COLOR = "#7C8967"; // muted sage — matches the reference swatch

function catmullRomPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function buildChartPoints(values: number[], width: number, height: number, padY: number): [number, number][] {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - padY - ((v - min) / range) * (height - padY * 2);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as [number, number];
  });
}

// ── Startups tab: animated valuation card ────────────────────────────────────
const STARTUP_VALUE_START = 48.2;
const STARTUP_VALUE_TARGET = 61.5;
const STARTUP_GAIN_TARGET = 24.3;
const STARTUP_ANIM_MS = 1600;

function StartupsShowcase({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);

  // Wait until the showcase has actually scrolled into view before animating
  useEffect(() => {
    if (!active) return;
    let raf: number;
    const t0 = performance.now();
    function tick(now: number) {
      const p = Math.min(1, (now - t0) / STARTUP_ANIM_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      setProgress(eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const points   = useMemo(() => buildChartPoints(VALUATION_TREND, CHART_W, CHART_H, 16), []);
  const linePath = useMemo(() => catmullRomPath(points), [points]);
  const areaPath = `${linePath} L${CHART_W},${CHART_H} L0,${CHART_H} Z`;
  const lastPoint = points[points.length - 1];

  const value    = STARTUP_VALUE_START + (STARTUP_VALUE_TARGET - STARTUP_VALUE_START) * progress;
  const gain     = STARTUP_GAIN_TARGET * progress;
  const dotShown = progress > 0.98;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3.5 mb-5 flex-none">
        <CompanyLogo company="Anthropic" size={40} />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-[#111827]">Anthropic</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700">AI / ML</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{t("landing.startups.privateLastRound", { date: "Mar 2026" })}</p>
        </div>
      </div>

      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">{t("landing.startups.valuationEstimate")}</span>
      <div className="flex items-baseline gap-3 mt-1.5 flex-wrap flex-none">
        <span className="text-4xl sm:text-5xl font-normal text-[#111827] tracking-tight tabular-nums">
          ${value.toFixed(1)}<span className="text-xl sm:text-2xl ml-1">B</span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 tabular-nums">
          <TrendingUp className="w-3 h-3" /> {gain.toFixed(1)}% · 90d
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-2 max-w-md flex-none">{t("landing.startups.modeledFrom")}</p>

      <div className="mt-4 flex-1 min-h-0 flex flex-col">
        <span className="text-[11px] font-bold tracking-[0.1em] text-gray-400 uppercase flex-none">{t("landing.startups.valuationTrend")}</span>
        <div className="relative flex-1 min-h-0 mt-2">
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" className="w-full h-full">
            <defs>
              <linearGradient id="showcaseChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLOR} stopOpacity="0.22" />
                <stop offset="100%" stopColor={CHART_COLOR} stopOpacity="0" />
              </linearGradient>
              <clipPath id="showcaseChartReveal">
                <rect x="0" y="0" width={CHART_W * progress} height={CHART_H} />
              </clipPath>
            </defs>
            <g clipPath="url(#showcaseChartReveal)">
              <path d={areaPath} fill="url(#showcaseChartFill)" stroke="none" />
              <path d={linePath} fill="none" stroke={CHART_COLOR} strokeWidth="3" strokeLinecap="round" />
            </g>
          </svg>
          <span
            className="absolute h-2.5 w-2.5 rounded-full transition-opacity duration-300"
            style={{
              left: `${(lastPoint[0] / CHART_W) * 100}%`,
              top: `${(lastPoint[1] / CHART_H) * 100}%`,
              transform: "translate(-50%, -50%)",
              background: CHART_COLOR,
              opacity: dotShown ? 1 : 0,
            }}
          >
            <span
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: CHART_COLOR, opacity: dotShown ? 0.55 : 0 }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Deal Flow tab ─────────────────────────────────────────────────────────────
function LivePulseDot({ title }: { title?: string }) {
  return (
    <span className="relative flex h-2 w-2 flex-none" title={title}>
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

function DealsShowcase(_props: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full">
      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">{t("landing.deals.eyebrow")}</span>
      <h3 className="text-2xl font-bold text-[#111827] mt-2 mb-1 flex-none">{t("landing.deals.title")}</h3>
      <p className="text-sm text-gray-400 mb-4 max-w-lg flex-none">{t("landing.deals.subtitle")}</p>

      <div className="overflow-auto -mx-1 flex-1 min-h-0">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="sticky top-0 bg-white">
            <tr className="text-[10px] font-bold tracking-wider text-gray-400 uppercase border-b border-gray-100">
              <th className="text-left py-2 px-1">{t("common.company")}</th>
              <th className="text-left py-2 px-1">{t("landing.deals.type")}</th>
              <th className="text-left py-2 px-1">{t("landing.deals.size")}</th>
              <th className="text-left py-2 px-1">{t("landing.deals.leadInvestors")}</th>
              <th className="text-right py-2 px-1">{t("common.valuation")}</th>
            </tr>
          </thead>
          <tbody>
            {DEAL_ROWS.map((row) => (
              <tr key={row.company} className="border-b border-gray-50 last:border-0">
                <td className="py-2.5 px-1">
                  <div className="flex items-center gap-2.5">
                    <CompanyLogo company={row.company} size={28} />
                    <span className="font-semibold text-[#111827] whitespace-nowrap">{row.company}</span>
                    {row.pulse && <LivePulseDot title={t("landing.deals.liveActivity")} />}
                  </div>
                </td>
                <td className="py-2.5 px-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[row.type]}`}>{stageLabel(row.type, t)}</span>
                </td>
                <td className="py-2.5 px-1 font-medium text-[#111827] whitespace-nowrap">{row.size}</td>
                <td className="py-2.5 px-1 text-gray-500 whitespace-nowrap">{row.leads}</td>
                <td className="py-2.5 px-1 text-right">
                  {row.estimated ? (
                    <span className="inline-flex items-center gap-1 justify-end whitespace-nowrap">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      <span className="text-xs font-semibold italic text-amber-700">~{row.valuation}</span>
                    </span>
                  ) : (
                    <span className="font-semibold text-[#111827] whitespace-nowrap">{row.valuation}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── AI Sourcing tab ───────────────────────────────────────────────────────────
const SOURCING_ASK_MS = 900;
// Simulated-cursor timeline: appear → move onto the button → click (fires Ask) → fade out
const CURSOR_START_MS = 350;
const CURSOR_MOVE_MS  = 700;
const CURSOR_CLICK_MS = 1350;
const CURSOR_HIDE_MS  = 1750;

type CursorStage = "hidden" | "start" | "move" | "click" | "gone";

function SimulatedCursor({ stage }: { stage: CursorStage }) {
  if (stage === "hidden" || stage === "gone") return null;
  const atButton = stage === "move" || stage === "click";
  const Icon = stage === "click" ? MousePointerClick : MousePointer2;
  return (
    <div
      className="absolute pointer-events-none z-10 ease-in-out"
      style={{
        right: atButton ? "20px" : "38%",
        top: atButton ? "50%" : "150%",
        transform: `translate(50%, -50%) scale(${stage === "click" ? 0.85 : 1})`,
        transition: `right ${CURSOR_MOVE_MS - CURSOR_START_MS}ms ease-in-out, top ${CURSOR_MOVE_MS - CURSOR_START_MS}ms ease-in-out, transform 200ms ease-in-out`,
      }}
    >
      <Icon className="w-5 h-5" fill={stage === "click" ? "none" : "#0F172A"} style={{ color: "#0F172A", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))" }} />
      {stage === "click" && (
        <span className="absolute -inset-2.5 rounded-full border-2 border-[#0F172A]/50 animate-ping" />
      )}
    </div>
  );
}

function SourcingShowcase({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const [asked,  setAsked]  = useState(false);
  const [asking, setAsking] = useState(false);
  const [cursorStage, setCursorStage] = useState<CursorStage>("hidden");
  const askTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleAsk() {
    if (asking || asked) return;
    setAsking(true);
    askTimeout.current = setTimeout(() => {
      setAsking(false);
      setAsked(true);
    }, SOURCING_ASK_MS);
  }

  // Fully automatic demo — a simulated cursor moves to "Ask" and clicks it, no user input
  // needed — but only once the showcase has actually scrolled into view
  useEffect(() => {
    if (!active) return;
    const timers = [
      setTimeout(() => setCursorStage("start"), CURSOR_START_MS),
      setTimeout(() => setCursorStage("move"), CURSOR_START_MS + 120),
      setTimeout(() => { setCursorStage("click"); handleAsk(); }, CURSOR_CLICK_MS),
      setTimeout(() => setCursorStage("gone"), CURSOR_HIDE_MS),
    ];
    return () => {
      timers.forEach(clearTimeout);
      if (askTimeout.current) clearTimeout(askTimeout.current);
    };
  }, [active]);

  return (
    <div className="flex flex-col h-full">
      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">{t("landing.sourcing.eyebrow")}</span>
      <h3 className="text-2xl font-bold text-[#111827] mt-2 mb-1 flex-none">{t("landing.sourcing.title")}</h3>
      <p className="text-sm text-gray-400 mb-6 flex-none">{t("landing.sourcing.subtitle")}</p>

      <div className="relative flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50/70 px-4 py-3 mb-6 flex-none">
        <Sparkles className="w-4 h-4 text-[#0F172A]/40 flex-none" />
        <span className="text-sm text-[#111827] font-medium">
          {t("landing.sourcing.query")}
          {!asked && !asking && <span className="typewriter-cursor" aria-hidden="true" />}
        </span>
        <button
          onClick={handleAsk}
          disabled={asking || asked}
          className="ml-auto flex-none flex items-center gap-1.5 rounded-lg bg-[#0F172A] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1e293b] disabled:opacity-70"
        >
          {asking && <Loader2 className="w-3 h-3 animate-spin" />}
          {asking ? t("landing.sourcing.searching") : asked ? t("landing.sourcing.asked") : t("landing.sourcing.ask")}
        </button>
        <SimulatedCursor stage={cursorStage} />
      </div>

      <div className="flex-1 min-h-0 relative">
        {!asked && !asking && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-300">
            <Search className="w-5 h-5" />
            <span className="text-xs font-medium text-gray-400">{t("landing.sourcing.aboutToSearch")}</span>
          </div>
        )}
        {asking && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#0F172A" }} />
            <span className="text-xs font-semibold tracking-wide text-gray-400">{t("landing.sourcing.searchingCompanies")}</span>
          </div>
        )}
        {asked && (
          <div className="overflow-auto -mx-1 h-full">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-[10px] font-bold tracking-wider text-gray-400 uppercase border-b border-gray-100">
                  <th className="text-left py-2 px-1">{t("common.company")}</th>
                  <th className="text-left py-2 px-1">{t("landing.sourcing.match")}</th>
                  <th className="text-left py-2 px-1">{t("metrics.momentum")}</th>
                  <th className="text-left py-2 px-1">{t("common.sector")}</th>
                  <th className="text-right py-2 px-1">{t("common.stage")}</th>
                </tr>
              </thead>
              <tbody>
                {SOURCING_ROWS.map((row, i) => (
                  <tr
                    key={row.company}
                    className="border-b border-gray-50 last:border-0"
                    style={{
                      animation: `showcaseFadeInUp 380ms ease-out ${i * 70}ms both, showcaseRowFlash 900ms ease-out ${i * 70 + 150}ms both`,
                    }}
                  >
                    <td className="py-2.5 px-1">
                      <div className="flex items-center gap-2">
                        <CompanyLogo company={row.company} size={24} />
                        <span className="font-semibold text-[#111827] whitespace-nowrap">{row.company}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-1">
                      <span className="inline-flex items-center justify-center min-w-[34px] px-1.5 py-0.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 font-bold text-xs">{row.match}</span>
                    </td>
                    <td className="py-2.5 px-1">
                      <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold text-xs">
                        <TrendingUp className="w-3 h-3" />{row.momentum}
                      </span>
                    </td>
                    <td className="py-2.5 px-1">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 mr-1 whitespace-nowrap">{sectorLabel(row.sector, t)}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 hidden sm:inline-block whitespace-nowrap">{row.tag2}</span>
                    </td>
                    <td className="py-2.5 px-1 text-right">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[row.stage]}`}>{stageLabel(row.stage, t)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── VC Directory tab ──────────────────────────────────────────────────────────
const FUND_FLASH_MS = 1050;
const VC_AUTOPLAY_DELAY_MS = 700;

function VCsShowcase({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const [selectedKey,  setSelectedKey]  = useState<string | null>(null);
  const [flashingKey,  setFlashingKey]  = useState<string | null>(null);
  const flashTimeout    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoplayTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = VC_FUNDS.find((f) => f.key === selectedKey) ?? null;

  function handleFundClick(vc: typeof VC_FUNDS[number]) {
    if (autoplayTimeout.current) { clearTimeout(autoplayTimeout.current); autoplayTimeout.current = null; }
    if (flashingKey) return;
    if (vc.pulse) {
      // Flash green three times to call out the highlighted fund, then reveal its portfolio
      setFlashingKey(vc.key);
      flashTimeout.current = setTimeout(() => {
        setFlashingKey(null);
        setSelectedKey(vc.key);
      }, FUND_FLASH_MS);
    } else {
      setSelectedKey(vc.key);
    }
  }

  // Fully automatic — the highlighted fund flashes and opens on its own, no click needed —
  // but only once the showcase has actually scrolled into view
  useEffect(() => {
    if (!active) return;
    const pulsing = VC_FUNDS.find((f) => f.pulse);
    if (pulsing) {
      autoplayTimeout.current = setTimeout(() => handleFundClick(pulsing), VC_AUTOPLAY_DELAY_MS);
    }
    return () => {
      if (autoplayTimeout.current) clearTimeout(autoplayTimeout.current);
      if (flashTimeout.current) clearTimeout(flashTimeout.current);
    };
  }, [active]);

  if (selected) {
    return (
      <div className="flex flex-col h-full" style={{ animation: "showcaseFadeInUp 300ms ease-out both" }}>
        <button
          onClick={() => setSelectedKey(null)}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-[#0F172A] transition-colors mb-4 flex-none"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {t("landing.vcs.allFunds")}
        </button>

        <div className="flex items-center justify-between flex-wrap gap-2 mb-1 flex-none">
          <h3 className="text-2xl font-bold text-[#111827]">{selected.name}</h3>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t("landing.vcs.portfolioMeta", { count: selected.portfolio, aum: selected.aum })}</span>
        </div>
        <p className="text-sm text-gray-400 mb-6 flex-none">{t("landing.vcs.portfolioSubtitle")}</p>

        <div className="overflow-auto -mx-1 flex-1 min-h-0">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-[10px] font-bold tracking-wider text-gray-400 uppercase border-b border-gray-100">
                <th className="text-left py-2 px-1">{t("common.company")}</th>
                <th className="text-left py-2 px-1">{t("common.round")}</th>
                <th className="text-right py-2 px-1">{t("landing.vcs.invested")}</th>
              </tr>
            </thead>
            <tbody>
              {selected.investments.map((inv, i) => (
                <tr
                  key={inv.company}
                  className="border-b border-gray-50 last:border-0"
                  style={{ animation: `showcaseFadeInUp 340ms ease-out ${i * 70}ms both` }}
                >
                  <td className="py-3 px-1">
                    <div className="flex items-center gap-2.5">
                      <CompanyLogo company={inv.company} size={26} />
                      <span className="font-semibold text-[#111827] whitespace-nowrap">{inv.company}</span>
                    </div>
                  </td>
                  <td className="py-3 px-1">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[inv.round] ?? "bg-gray-100 border-gray-200 text-gray-600"}`}>{stageLabel(inv.round, t)}</span>
                  </td>
                  <td className="py-3 px-1 text-right">
                    {inv.estimated ? (
                      <span className="inline-flex items-center gap-1 justify-end whitespace-nowrap">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        <span className="text-xs font-semibold italic text-amber-700">~{inv.amount}</span>
                      </span>
                    ) : (
                      <span className="font-semibold text-[#111827] whitespace-nowrap">{inv.amount}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">{t("landing.vcs.eyebrow")}</span>
      <h3 className="text-2xl font-bold text-[#111827] mt-2 mb-1 flex-none">{t("landing.vcs.title")}</h3>
      <p className="text-sm text-gray-400 mb-6 max-w-lg flex-none">{t("landing.vcs.subtitle")}</p>

      <div className="grid sm:grid-cols-3 gap-4 flex-1 min-h-0">
        {VC_FUNDS.map((vc) => (
          <button
            key={vc.key}
            onClick={() => handleFundClick(vc)}
            style={flashingKey === vc.key ? { animation: `showcaseTripleFlash ${FUND_FLASH_MS}ms ease-in-out` } : undefined}
            className={`relative text-left rounded-lg border p-5 transition-all hover:-translate-y-0.5 ${
              vc.pulse ? "border-emerald-300 bg-emerald-50/40 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]" : "border-gray-100 bg-gray-50/60 hover:border-gray-200"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <p className="font-bold text-[#111827]">{vc.name}</p>
              {vc.pulse && <LivePulseDot title={t("landing.deals.liveActivity")} />}
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {vc.stages.map((s) => (
                <span key={s} className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[s]}`}>{stageLabel(s, t)}</span>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">{t("metrics.aum")}</span>
              <span className="font-semibold text-[#111827]">{vc.aum}</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-gray-400">{t("metrics.portfolio")}</span>
              <span className="font-semibold text-[#111827]">{t("landing.vcs.companiesShort", { count: vc.portfolio })}</span>
            </div>
            <span className={`mt-3 inline-block text-[10px] font-semibold ${vc.pulse ? "text-emerald-600" : "text-gray-400"}`}>
              {t("landing.vcs.viewPortfolio")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const SHOWCASE_CONTENT: Record<string, React.ComponentType<{ active: boolean }>> = {
  startups: StartupsShowcase,
  deals:    DealsShowcase,
  sourcing: SourcingShowcase,
  vcs:      VCsShowcase,
};

// ── Persona carousel: three audience-specific slides, arrow-navigated ───────
const PERSONAS_BG = "#CDD1C3"; // sage wash the section transitions into — unchanged from before
const PERSONA_FRAME_BG = "#E4E6E1"; // neutral gray frame around the illustration, matches the page's light-gray background

const PERSONAS = ["investors", "bizdev", "entrepreneurs"] as const;
type PersonaId = (typeof PERSONAS)[number];

// Flat layered-terrain illustrations, one per persona, all sharing the same
// visual grammar: three tonal layers of the app's own sage accent (the same
// green used for the hero chart / Market Map hubs) forming a landscape,
// plus a navy data-line overlay with one highlighted accent moment. Same
// family, different motif per audience — not photography, since this app
// has no real product photography to draw from.
const TERRAIN_LIGHT  = "#D9DDCE"; // back layer, nearest the card's white
const TERRAIN_MID    = "#ABB496"; // mid layer
const TERRAIN_DARK    = "#7C8967"; // front layer — the established brand sage
const ILLUSTRATION_NAVY  = "#111827";
const ILLUSTRATION_AMBER = "#D97706";

function InvestorsIllustration() {
  return (
    <svg viewBox="0 0 280 200" fill="none" className="w-full h-full" aria-hidden="true">
      <polygon points="0,180 45,120 90,155 135,95 185,145 235,105 280,150 280,180" fill={TERRAIN_LIGHT} />
      <polygon points="15,180 90,75 165,180" fill={TERRAIN_MID} />
      <polygon points="140,180 212,52 280,180" fill={TERRAIN_DARK} />
      <path
        d="M28 163 L68 142 L108 118 L148 98 L188 72 L224 42"
        stroke={ILLUSTRATION_NAVY}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {[[28, 163], [68, 142], [108, 118], [148, 98], [188, 72]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" fill={ILLUSTRATION_NAVY} />
      ))}
      <circle cx="224" cy="42" r="10" fill={TERRAIN_DARK} fillOpacity="0.22" />
      <circle cx="224" cy="42" r="6" fill={TERRAIN_DARK} stroke="#fff" strokeWidth="1.5" />
      <path d="M236 32 L250 20 M250 20 L250 29 M250 20 L241 20" stroke={ILLUSTRATION_AMBER} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BizDevIllustration() {
  const nodes: [number, number][] = [[62, 108], [128, 78], [196, 96], [238, 128]];
  const highlighted = 2;
  return (
    <svg viewBox="0 0 280 200" fill="none" className="w-full h-full" aria-hidden="true">
      <path d="M0,180 L0,142 Q70,104 140,132 Q210,156 280,122 L280,180 Z" fill={TERRAIN_LIGHT} />
      <path d="M18,180 L18,124 Q82,86 152,114 Q170,122 170,140 L170,180 Z" fill={TERRAIN_MID} />
      <path d="M128,180 L128,132 Q190,92 258,120 Q274,127 280,138 L280,180 Z" fill={TERRAIN_DARK} />
      {nodes.slice(0, -1).map(([x1, y1], i) => {
        const [x2, y2] = nodes[i + 1];
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ILLUSTRATION_NAVY} strokeOpacity="0.55" strokeWidth="1.75" />;
      })}
      <line x1={nodes[0][0]} y1={nodes[0][1]} x2={nodes[2][0]} y2={nodes[2][1]} stroke={ILLUSTRATION_NAVY} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="2 4" />
      {nodes.map(([cx, cy], i) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx} cy={cy}
          r={i === highlighted ? 8 : 4.5}
          fill={i === highlighted ? ILLUSTRATION_AMBER : "#fff"}
          stroke={i === highlighted ? ILLUSTRATION_AMBER : ILLUSTRATION_NAVY}
          strokeWidth="1.75"
        />
      ))}
    </svg>
  );
}

function EntrepreneursIllustration() {
  return (
    <svg viewBox="0 0 280 200" fill="none" className="w-full h-full" aria-hidden="true">
      <polygon points="0,180 50,132 100,160 150,102 200,150 250,122 280,142 280,180" fill={TERRAIN_LIGHT} />
      <polygon points="8,180 70,92 142,180" fill={TERRAIN_MID} />
      <polygon points="150,180 206,112 262,180" fill={TERRAIN_DARK} />
      <path
        d="M16 172 Q55 154 88 160 Q120 166 150 142 Q178 120 206 114"
        stroke={ILLUSTRATION_NAVY}
        strokeOpacity="0.65"
        strokeWidth="2"
        strokeDasharray="1 7"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16" cy="172" r="3.5" fill={ILLUSTRATION_NAVY} />
      <line x1="206" y1="114" x2="206" y2="82" stroke={ILLUSTRATION_NAVY} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M206 82 L230 90 L206 99 Z" fill={ILLUSTRATION_AMBER} />
      <circle cx="206" cy="114" r="9" fill={TERRAIN_DARK} fillOpacity="0.22" />
      <circle cx="206" cy="114" r="5" fill={TERRAIN_DARK} stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

const PERSONA_ILLUSTRATIONS: Record<PersonaId, React.ComponentType> = {
  investors: InvestorsIllustration,
  bizdev: BizDevIllustration,
  entrepreneurs: EntrepreneursIllustration,
};

function PersonaNavButton({
  direction, onClick, disabled,
}: { direction: "prev" | "next"; onClick: () => void; disabled: boolean }) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "Previous" : "Next"}
      className={`flex-none inline-flex items-center justify-center w-11 h-11 rounded-full border transition-all duration-200 ${
        disabled
          ? "border-[#111827]/15 text-[#111827]/25 cursor-default"
          : "border-[#111827] bg-[#111827] text-white hover:scale-105 hover:shadow-[0_6px_16px_rgba(17,24,39,0.25)]"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function PersonaCarouselSection() {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const persona = PERSONAS[activeIndex];
  const Illustration = PERSONA_ILLUSTRATIONS[persona];

  function go(delta: number) {
    setActiveIndex((i) => Math.max(0, Math.min(PERSONAS.length - 1, i + delta)));
  }

  return (
    <section
      className="w-full"
      style={{ background: PERSONAS_BG }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      <div className="max-w-[1200px] mx-auto px-6 lg:px-12 py-12 lg:py-16">
        <div className="flex items-center gap-3 mb-6 lg:mb-8">
          <span className="h-px w-8" style={{ background: "rgba(17,24,39,0.3)" }} />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#111827]/60">
            {t("landing.personas.eyebrow")}
          </span>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          <div key={`text-${persona}`} style={{ animation: "showcaseFadeInUp 450ms ease-out both" }}>
            <span className="block text-[11px] font-bold uppercase tracking-[0.16em] mb-3" style={{ color: TERRAIN_DARK }}>
              {t(`landing.personas.${persona}.label`)}
            </span>
            <h2
              className="text-2xl sm:text-3xl md:text-[2.25rem] font-normal text-[#111827] tracking-tight mb-4"
              style={{ fontFamily: "'Playfair Display', serif", lineHeight: 1.15 }}
            >
              {t(`landing.personas.${persona}.heading`)}
            </h2>
            <p className="text-sm sm:text-base text-[#111827]/70 leading-relaxed max-w-xl">
              {t(`landing.personas.${persona}.body`)}
            </p>
          </div>

          <div
            key={`illus-${persona}`}
            className="rounded-[10px] p-3 sm:p-4 lg:max-w-[380px] lg:ml-auto lg:w-full"
            style={{ background: PERSONA_FRAME_BG, animation: "showcaseFadeInUp 450ms ease-out both" }}
          >
            <div className="rounded-lg bg-white shadow-[0_8px_20px_rgba(0,0,0,0.08)] aspect-[4/3] flex items-center justify-center p-4">
              <Illustration />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5 mt-8 lg:mt-10">
          <PersonaNavButton direction="prev" onClick={() => go(-1)} disabled={activeIndex === 0} />
          <PersonaNavButton direction="next" onClick={() => go(1)} disabled={activeIndex === PERSONAS.length - 1} />
          <div className="flex-1 h-px relative overflow-hidden rounded-full" style={{ background: "rgba(17,24,39,0.12)" }}>
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{ width: `${((activeIndex + 1) / PERSONAS.length) * 100}%`, background: "#111827" }}
            />
          </div>
          <span className="text-xs font-semibold tabular-nums text-[#111827]/60 flex-none">
            0{activeIndex + 1} <span className="text-[#111827]/30 mx-0.5">{t("landing.personas.counterOf")}</span> 0{PERSONAS.length}
          </span>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  const { t } = useTranslation();
  const navigate        = useNavigate();
  const [scrolled,      setScrolled]      = useState(false);
  const [typedCount,     setTypedCount]     = useState(0);
  const [subheadVisible, setSubheadVisible] = useState(false);
  const [activeTab,     setActiveTab]     = useState("sourcing"); // tab bar highlight (target)
  const [displayTab,    setDisplayTab]    = useState("sourcing"); // tab actually rendered
  const [tabLoading,    setTabLoading]    = useState(false);
  const [showcaseInView, setShowcaseInView] = useState(false);
  const tabSwitchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showcaseRef = useRef<HTMLDivElement>(null);
  const headline = t("landing.headline");
  const headlineDone  = typedCount >= headline.length;

  // Switching tabs shows a brief loading state before the new panel mounts
  function handleTabClick(key: string) {
    if (key === activeTab) return;
    setActiveTab(key);
    setTabLoading(true);
    if (tabSwitchTimeout.current) clearTimeout(tabSwitchTimeout.current);
    tabSwitchTimeout.current = setTimeout(() => {
      setDisplayTab(key);
      setTabLoading(false);
    }, 550);
  }
  useEffect(() => () => { if (tabSwitchTimeout.current) clearTimeout(tabSwitchTimeout.current); }, []);

  // The showcase's self-playing demos (Startups chart, AI Sourcing "Ask", VC auto-flash)
  // should only start once the section has actually scrolled into view
  useEffect(() => {
    const el = showcaseRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShowcaseInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Header gains a light glass border/shadow once the page scrolls past the hero
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.6);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Typewriter reveal of the headline, left to right, one character at a time
  // Re-runs when the language changes so the headline retypes in the newly
  // selected language rather than freezing mid-way through the old string.
  useEffect(() => {
    setTypedCount(0);
    setSubheadVisible(false);
    let charIndex = 0;
    let intervalId: ReturnType<typeof setInterval>;
    const startId = setTimeout(() => {
      intervalId = setInterval(() => {
        charIndex += 1;
        setTypedCount(charIndex);
        if (charIndex >= headline.length) clearInterval(intervalId);
      }, TYPE_SPEED_MS);
    }, TYPE_START_DELAY_MS);
    return () => { clearTimeout(startId); clearInterval(intervalId); };
  }, [headline]);

  // Subheading simply fades in as a whole once the headline finishes typing
  // (no typewriter effect on this one — it just appears after a brief pause).
  useEffect(() => {
    if (!headlineDone) return;
    const startId = setTimeout(() => setSubheadVisible(true), SUBHEAD_PAUSE_MS);
    return () => clearTimeout(startId);
  }, [headlineDone]);

  // Fade-up for the scroll cue, once the subheading finishes typing
  function tx(visible: boolean, delayMs: number): React.CSSProperties {
    return {
      opacity:    visible ? 1 : 0,
      transform:  visible ? "translateY(0)" : "translateY(14px)",
      transition: `opacity 700ms ease-out ${delayMs}ms, transform 700ms ease-out ${delayMs}ms`,
    };
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6] font-sans selection:bg-amber-400/10">

      {/* ── Fixed header ─────────────────────────────────────────────────────── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 flex h-20 w-full items-center justify-between px-6 lg:px-12"
        style={{
          background:    scrolled ? "rgba(255,255,255,0.94)" : "rgba(255,255,255,0.7)",
          backdropFilter:"blur(14px)",
          borderBottom:  scrolled ? "1px solid rgba(0,0,0,0.07)" : "none",
          boxShadow:     scrolled ? "0 2px 20px rgba(0,0,0,0.06)" : "none",
          transition:    "background 400ms ease, border-color 400ms ease, box-shadow 400ms ease",
        }}
      >
        {/* Logo — clickable, like every other site's logo. A signed-out
            visitor is already home, so this just returns them to the top. */}
        <button
          type="button"
          onClick={async () => navigate(await homePathNow("/"))}
          aria-label={t("nav.goHome")}
          className="flex items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/30"
        >
          <BrandMark size={32} />
          <BrandWordmark className="text-xl tracking-tight text-[#0F172A]" />
        </button>

        {/* Nav */}
        <div className="flex items-center gap-3 sm:gap-5">
          {/* The landing page has its own header rather than the app's TopNav,
              so the switcher is mounted here too — this is where a first-time
              visitor (who always starts in English) changes language. */}
          <LanguageSelector />
          <button
            onClick={() => navigate("/login")}
            className="text-sm font-medium text-gray-500 transition-colors duration-300 hover:text-[#111827]"
          >
            {t("header.logIn")}
          </button>
          {/* Signed in -> the dashboard they already have. Signed out ->
              /pricing to choose a plan. Previously this always went to
              /pricing, so an existing customer clicking "View Dashboard" was
              shown a plan picker instead of their dashboard. */}
          <button
            onClick={async () => navigate(await homePathNow("/pricing"))}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-all duration-300 bg-[#111827] border border-black/10 text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] hover:bg-gray-900"
          >
            {t("landing.viewDashboard")}
          </button>
        </div>
      </header>

      {/* ── Hero: typewriter headline over a light backdrop ───────────────────── */}
      <section
        className="relative w-full flex flex-col items-start justify-center text-left px-6 lg:px-12"
        style={{ minHeight: "100svh", background: "linear-gradient(180deg, #FAFAF9 0%, #F3F4F6 100%)" }}
      >
        <div className="h-px w-16 mb-10" style={{ background: "linear-gradient(90deg, #F59E0B, transparent)" }} />

        <h1
          className="max-w-[1100px] text-[2.4rem] sm:text-5xl md:text-[3.8rem] lg:text-[4.6rem] font-normal text-[#111827] tracking-tight"
          style={{ fontFamily: "'Playfair Display', serif", lineHeight: "1.15" }}
        >
          {headline.slice(0, typedCount)}
          {!subheadVisible && <span className="typewriter-cursor" aria-hidden="true" />}
        </h1>

        <p
          className="max-w-[720px] mt-6 text-xl md:text-2xl leading-relaxed font-normal text-[#374151]"
          style={tx(subheadVisible, 0)}
        >
          {t("landing.subhead")}
        </p>

        {/* Scroll indicator */}
        <div
          style={tx(subheadVisible, 500)}
          className="absolute bottom-9 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 pointer-events-none"
        >
          <span className="text-[9px] font-semibold tracking-[0.32em] text-[#0F172A]/30 uppercase">{t("landing.scroll")}</span>
          <ChevronDown className="w-4 h-4 text-[#0F172A]/25 animate-bounce" />
        </div>
      </section>

      {/* ── Interactive product showcase ─────────────────────────────────────── */}
      <section ref={showcaseRef} className="w-full max-w-[1040px] mx-auto px-6 lg:px-12 mb-32">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold tracking-[0.22em] text-[#0F172A]/40 uppercase">{t("landing.insideEyebrow")}</span>
          <h2
            className="mt-3 text-3xl md:text-4xl font-normal text-[#111827] tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {t("landing.insideTitle")}
          </h2>
        </div>

        <div
          className="rounded-[10px] border border-gray-200/80 p-2 sm:p-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
          style={{ background: "linear-gradient(180deg, #EEF1F4 0%, #E4E9ED 100%)" }}
        >
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-1 pt-1 pb-2">
            {SHOWCASE_TABS.map((tab) => {
              const active = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  onClick={() => handleTabClick(tab.key)}
                  className={`relative flex-1 flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-center rounded-lg transition-all whitespace-nowrap ${
                    active ? "bg-white text-[#0F172A] shadow-sm" : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {t(tab.labelKey)}
                  {active && <span className="absolute left-4 right-4 -bottom-[1px] h-[2px] rounded-full bg-[#0F172A]" />}
                </button>
              );
            })}
          </div>

          {/* Window — fixed size so switching tabs never resizes the card */}
          <div className="rounded-[10px] bg-white border border-gray-100 p-6 sm:p-10 h-[600px] sm:h-[520px] flex flex-col overflow-hidden">
            <div className="flex items-center gap-1.5 mb-6 flex-none">
              <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
            </div>

            <div className="flex-1 min-h-0 relative">
              {tabLoading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#0F172A" }} />
                  <span className="text-xs font-semibold tracking-wide text-gray-400">
                    {t("landing.loadingTab", {
                      tab: t(SHOWCASE_TABS.find((tab) => tab.key === activeTab)?.labelKey ?? ""),
                    })}
                  </span>
                </div>
              ) : (
                (() => {
                  const TabContent = SHOWCASE_CONTENT[displayTab];
                  return <TabContent active={showcaseInView} />;
                })()
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Use cases: scroll-linked list with a pinned right panel ──────────── */}
      <PersonaCarouselSection />

      {/* ── Final CTA + Footer: one continuous dark block, hard-edged on every
          side — no gray gap and no rounded corners, same sharp cut used for
          the sage section's own top/bottom edges. ─────────────────────────── */}
      <section className="w-full px-6 lg:px-12 py-16 md:py-20 flex flex-col items-center text-center" style={{ background: DARK_SECTION_BG }}>
        <h2
          className="text-4xl md:text-5xl text-white font-medium tracking-tight mb-4"
          style={{ fontFamily: "'Playfair Display', serif", lineHeight: "1.2" }}
        >
          {t("landing.ctaTitle")}
        </h2>
        <button
          onClick={() => navigate("/pricing")}
          className="rounded-lg bg-white px-10 py-4 text-base font-semibold text-[#111827] shadow-[0_4px_14px_0_rgba(0,0,0,0.25)] transition-all hover:bg-gray-100 hover:-translate-y-0.5"
        >
          {t("landing.ctaButton")}
        </button>
      </section>

      <footer className="w-full" style={{ background: DARK_SECTION_BG }}>
        <div className="max-w-[1200px] mx-auto px-6 lg:px-12 pt-8 pb-16">
          <span className="block text-xs font-semibold tracking-[0.14em] text-gray-500 uppercase mb-6">{t("landing.explore")}</span>
          <nav className="flex flex-col gap-4 mb-10">
            {FOOTER_LINK_KEYS.map((key) => {
              const path = FOOTER_LINK_PATHS[key];
              return (
                <a
                  key={key}
                  href={path ?? "#"}
                  onClick={path ? (e) => { e.preventDefault(); navigate(path); } : undefined}
                  className="text-sm text-white hover:text-gray-300 transition-colors w-fit"
                >
                  {t(`landing.footer.${key}`)}
                </a>
              );
            })}
          </nav>
          <div className="flex items-center gap-4 pt-8 border-t border-white/10">
            <a href="#" aria-label="LinkedIn" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white hover:bg-white/10 transition-colors">
              <Linkedin className="w-4 h-4" />
            </a>
            <a href="#" aria-label="Instagram" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white hover:bg-white/10 transition-colors">
              <Instagram className="w-4 h-4" />
            </a>
          </div>
        </div>
      </footer>

    </div>
  );
}
