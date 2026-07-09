import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ChevronDown, Sparkles, TrendingUp, Loader2, Search, ArrowLeft,
  Building2, MousePointer2, MousePointerClick,
} from "lucide-react";
import {
  SiAnthropic, SiDatabricks, SiStripe, SiPerplexity, SiBrex, SiNotion, SiDiscord, SiMiro,
  SiHuggingface, SiKlarna, SiRetool, SiLinear, SiVercel, SiZapier, SiWebflow, SiCoda, SiRevolut,
} from "react-icons/si";
import type { IconType } from "react-icons";
import { useNavigate } from "react-router";

// ── Hero typewriter copy ─────────────────────────────────────────────────────
const HEADLINE = "Bridging the Gap between Private Innovation and Public Markets.";
const SUBHEAD  = "An AI-driven investment research platform that transforms global market data into a clear strategy.";
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

const SHOWCASE_TABS: { key: string; label: string }[] = [
  { key: "sourcing", label: "AI Sourcing" },
  { key: "startups", label: "Startups" },
  { key: "vcs",      label: "VC Directory" },
  { key: "deals",    label: "Deal Flow" },
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

const SOURCING_QUERY = "High-growth B2B SaaS companies";
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
          <p className="text-xs text-gray-400 mt-0.5">Private · Last round Mar 2026</p>
        </div>
      </div>

      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">AlphaMap Valuation Estimate</span>
      <div className="flex items-baseline gap-3 mt-1.5 flex-wrap flex-none">
        <span className="text-4xl sm:text-5xl font-normal text-[#111827] tracking-tight tabular-nums" style={{ fontFamily: "'Playfair Display', serif" }}>
          ${value.toFixed(1)}<span className="text-xl sm:text-2xl ml-1">B</span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 tabular-nums">
          <TrendingUp className="w-3 h-3" /> {gain.toFixed(1)}% · 90d
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-2 max-w-md flex-none">Modeled from funding velocity, hiring signals &amp; sector multiples across 40+ comparable rounds.</p>

      <div className="mt-4 flex-1 min-h-0 flex flex-col">
        <span className="text-[11px] font-bold tracking-[0.1em] text-gray-400 uppercase flex-none">Valuation trend · 12 mo</span>
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
function LivePulseDot() {
  return (
    <span className="relative flex h-2 w-2 flex-none" title="Live activity">
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

function DealsShowcase(_props: { active: boolean }) {
  return (
    <div className="flex flex-col h-full">
      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">Deal Flow</span>
      <h3 className="text-2xl font-bold text-[#111827] mt-2 mb-1 flex-none">Every private round, tracked in real time</h3>
      <p className="text-sm text-gray-400 mb-4 max-w-lg flex-none">From seed checks to late-stage megarounds — sourced, verified, and structured the moment they close.</p>

      <div className="overflow-auto -mx-1 flex-1 min-h-0">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="sticky top-0 bg-white">
            <tr className="text-[10px] font-bold tracking-wider text-gray-400 uppercase border-b border-gray-100">
              <th className="text-left py-2 px-1">Company</th>
              <th className="text-left py-2 px-1">Type</th>
              <th className="text-left py-2 px-1">Size</th>
              <th className="text-left py-2 px-1">Lead Investors</th>
              <th className="text-right py-2 px-1">Valuation</th>
            </tr>
          </thead>
          <tbody>
            {DEAL_ROWS.map((row) => (
              <tr key={row.company} className="border-b border-gray-50 last:border-0">
                <td className="py-2.5 px-1">
                  <div className="flex items-center gap-2.5">
                    <CompanyLogo company={row.company} size={28} />
                    <span className="font-semibold text-[#111827] whitespace-nowrap">{row.company}</span>
                    {row.pulse && <LivePulseDot />}
                  </div>
                </td>
                <td className="py-2.5 px-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[row.type]}`}>{row.type}</span>
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
      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">Company Sourcing</span>
      <h3 className="text-2xl font-bold text-[#111827] mt-2 mb-1 flex-none">Find your next investment</h3>
      <p className="text-sm text-gray-400 mb-6 flex-none">Search across startups, VCs, and deals in plain English.</p>

      <div className="relative flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 px-4 py-3 mb-6 flex-none">
        <Sparkles className="w-4 h-4 text-[#0F172A]/40 flex-none" />
        <span className="text-sm text-[#111827] font-medium">
          {SOURCING_QUERY}
          {!asked && !asking && <span className="typewriter-cursor" aria-hidden="true" />}
        </span>
        <button
          onClick={handleAsk}
          disabled={asking || asked}
          className="ml-auto flex-none flex items-center gap-1.5 rounded-full bg-[#0F172A] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1e293b] disabled:opacity-70"
        >
          {asking && <Loader2 className="w-3 h-3 animate-spin" />}
          {asking ? "Searching…" : asked ? "Asked ✓" : "Ask"}
        </button>
        <SimulatedCursor stage={cursorStage} />
      </div>

      <div className="flex-1 min-h-0 relative">
        {!asked && !asking && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-300">
            <Search className="w-5 h-5" />
            <span className="text-xs font-medium text-gray-400">AlphaMap is about to search…</span>
          </div>
        )}
        {asking && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#0F172A" }} />
            <span className="text-xs font-semibold tracking-wide text-gray-400">Searching 60,000+ companies…</span>
          </div>
        )}
        {asked && (
          <div className="overflow-auto -mx-1 h-full">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-[10px] font-bold tracking-wider text-gray-400 uppercase border-b border-gray-100">
                  <th className="text-left py-2 px-1">Company</th>
                  <th className="text-left py-2 px-1">Match</th>
                  <th className="text-left py-2 px-1">Momentum</th>
                  <th className="text-left py-2 px-1">Sector</th>
                  <th className="text-right py-2 px-1">Stage</th>
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
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 mr-1 whitespace-nowrap">{row.sector}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 hidden sm:inline-block whitespace-nowrap">{row.tag2}</span>
                    </td>
                    <td className="py-2.5 px-1 text-right">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[row.stage]}`}>{row.stage}</span>
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
          <ArrowLeft className="w-3.5 h-3.5" /> All funds
        </button>

        <div className="flex items-center justify-between flex-wrap gap-2 mb-1 flex-none">
          <h3 className="text-2xl font-bold text-[#111827]">{selected.name}</h3>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{selected.portfolio} portfolio cos. · {selected.aum} AUM</span>
        </div>
        <p className="text-sm text-gray-400 mb-6 flex-none">Portfolio investments AlphaMap tracks for this fund.</p>

        <div className="overflow-auto -mx-1 flex-1 min-h-0">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-[10px] font-bold tracking-wider text-gray-400 uppercase border-b border-gray-100">
                <th className="text-left py-2 px-1">Company</th>
                <th className="text-left py-2 px-1">Round</th>
                <th className="text-right py-2 px-1">Invested</th>
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
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[inv.round] ?? "bg-gray-100 border-gray-200 text-gray-600"}`}>{inv.round}</span>
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
      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">VC Directory</span>
      <h3 className="text-2xl font-bold text-[#111827] mt-2 mb-1 flex-none">Every fund that matters, in one view</h3>
      <p className="text-sm text-gray-400 mb-6 max-w-lg flex-none">Stage focus, sector concentration, and portfolio activity — normalized across 5,000+ firms.</p>

      <div className="grid sm:grid-cols-3 gap-4 flex-1 min-h-0">
        {VC_FUNDS.map((vc) => (
          <button
            key={vc.key}
            onClick={() => handleFundClick(vc)}
            style={flashingKey === vc.key ? { animation: `showcaseTripleFlash ${FUND_FLASH_MS}ms ease-in-out` } : undefined}
            className={`relative text-left rounded-2xl border p-5 transition-all hover:-translate-y-0.5 ${
              vc.pulse ? "border-emerald-300 bg-emerald-50/40 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]" : "border-gray-100 bg-gray-50/60 hover:border-gray-200"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <p className="font-bold text-[#111827]">{vc.name}</p>
              {vc.pulse && <LivePulseDot />}
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {vc.stages.map((s) => (
                <span key={s} className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[s]}`}>{s}</span>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">AUM</span>
              <span className="font-semibold text-[#111827]">{vc.aum}</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-gray-400">Portfolio</span>
              <span className="font-semibold text-[#111827]">{vc.portfolio} cos.</span>
            </div>
            <span className={`mt-3 inline-block text-[10px] font-semibold ${vc.pulse ? "text-emerald-600" : "text-gray-400"}`}>
              View portfolio →
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

// ── Scroll-linked use cases: left list scrolls, right panel stays pinned ─────
const USE_CASES_HEADLINE =
  "Beyond the data, you can access trading history, company growth signals, investor insights, and key analyses—";

const USE_CASES = [
  { heading: "Cross-Market Correlation",   body: "Discover hidden links between private funding rounds and public stock movements." },
  { heading: "AI-Powered Narratives",      body: "Translate raw data into clear, actionable intelligence and business stories." },
  { heading: "Capital Flow Visualization", body: "Track where leading investors are moving their money across private and public sectors." },
];

const USE_CASES_BG      = "#CDD1C3"; // sage wash the section transitions into
const USE_CASES_PANEL   = "#DEE1D5"; // lighter tint for the pinned panel

function UseCasesSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveIndex(i); },
        { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
      );
      observer.observe(el);
      observers.push(observer);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const active = USE_CASES[activeIndex];

  return (
    <section className="w-full" style={{ background: USE_CASES_BG }}>
      <div className="max-w-[1200px] mx-auto px-6 lg:px-12 py-24 lg:py-32 grid lg:grid-cols-2 gap-12 lg:gap-20">
        {/* Left: headline + compact list */}
        <div>
          <h2
            className="text-2xl sm:text-3xl md:text-[2.25rem] font-normal text-[#111827] tracking-tight mb-12 lg:mb-16 max-w-lg"
            style={{ fontFamily: "'Playfair Display', serif", lineHeight: 1.25 }}
          >
            {USE_CASES_HEADLINE}
          </h2>

          <div className="flex flex-col">
            {USE_CASES.map((item, i) => (
              <div
                key={item.heading}
                ref={(el) => { itemRefs.current[i] = el; }}
                className="py-7 sm:py-8 border-t first:border-t-0"
                style={{ borderColor: "rgba(17,24,39,0.12)" }}
              >
                <h3
                  className="text-lg sm:text-xl font-semibold tracking-tight transition-colors duration-300"
                  style={{ color: i === activeIndex ? "#111827" : "rgba(17,24,39,0.35)" }}
                >
                  <span className="mr-2">&amp;</span>{item.heading}
                </h3>
              </div>
            ))}
          </div>
        </div>

        {/* Right: pinned panel — only this side updates as you scroll the list.
            This grid item stretches to the row's full height by default (it's
            the tall left column that sets the row height); the inner div is
            what actually carries position:sticky, using that extra height as
            its room to hold in place while the list scrolls past. */}
        <div>
          <div className="lg:sticky lg:top-32">
            <div className="rounded-[28px] p-10 sm:p-14 min-h-[280px] flex items-center overflow-hidden" style={{ background: USE_CASES_PANEL }}>
              <p
                key={activeIndex}
                className="text-xl sm:text-2xl font-normal text-[#111827] leading-relaxed"
                style={{ fontFamily: "'Playfair Display', serif", animation: "showcaseFadeInUp 500ms ease-out both" }}
              >
                {active.body}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  const navigate        = useNavigate();
  const [scrolled,      setScrolled]      = useState(false);
  const [typedCount,    setTypedCount]    = useState(0);
  const [subTypedCount, setSubTypedCount] = useState(0);
  const [activeTab,     setActiveTab]     = useState("sourcing"); // tab bar highlight (target)
  const [displayTab,    setDisplayTab]    = useState("sourcing"); // tab actually rendered
  const [tabLoading,    setTabLoading]    = useState(false);
  const [showcaseInView, setShowcaseInView] = useState(false);
  const tabSwitchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showcaseRef = useRef<HTMLDivElement>(null);
  const headlineDone  = typedCount >= HEADLINE.length;
  const subheadStarted = subTypedCount > 0;
  const subheadDone    = subTypedCount >= SUBHEAD.length;

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
  useEffect(() => {
    let charIndex = 0;
    let intervalId: ReturnType<typeof setInterval>;
    const startId = setTimeout(() => {
      intervalId = setInterval(() => {
        charIndex += 1;
        setTypedCount(charIndex);
        if (charIndex >= HEADLINE.length) clearInterval(intervalId);
      }, TYPE_SPEED_MS);
    }, TYPE_START_DELAY_MS);
    return () => { clearTimeout(startId); clearInterval(intervalId); };
  }, []);

  // Typewriter reveal of the subheading, starting once the headline is fully typed
  useEffect(() => {
    if (!headlineDone) return;
    let charIndex = 0;
    let intervalId: ReturnType<typeof setInterval>;
    const startId = setTimeout(() => {
      intervalId = setInterval(() => {
        charIndex += 1;
        setSubTypedCount(charIndex);
        if (charIndex >= SUBHEAD.length) clearInterval(intervalId);
      }, TYPE_SPEED_MS);
    }, SUBHEAD_PAUSE_MS);
    return () => { clearTimeout(startId); clearInterval(intervalId); };
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
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "#0F172A" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
              <path d="M15 8 C12 8 9 12 7 15 A4 4 0 1 1 8 8 C11 8 14 13 16 16 C17.5 18 19 12 20 6" />
              <polyline points="15 6 20 6 20 11" />
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight text-[#0F172A]">
            AlphaMap
          </span>
        </div>

        {/* Nav */}
        <div className="flex items-center gap-5">
          <button
            className="text-sm font-medium text-gray-500 transition-colors duration-300 hover:text-[#111827]"
          >
            Log In
          </button>
          <button
            onClick={() => navigate("/dashboard")}
            className="rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-300 bg-white border border-black/10 text-[#111827] shadow-[0_1px_4px_rgba(0,0,0,0.08)] hover:bg-gray-50"
          >
            View Dashboard
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
          {HEADLINE.slice(0, typedCount)}
          {!subheadStarted && <span className="typewriter-cursor" aria-hidden="true" />}
        </h1>

        <p
          className="max-w-[720px] mt-6 text-xl md:text-2xl leading-relaxed font-normal text-[#374151]"
        >
          {SUBHEAD.slice(0, subTypedCount)}
          {subheadStarted && <span className="typewriter-cursor" aria-hidden="true" />}
        </p>

        {/* Scroll indicator */}
        <div
          style={tx(subheadDone, 500)}
          className="absolute bottom-9 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 pointer-events-none"
        >
          <span className="text-[9px] font-semibold tracking-[0.32em] text-[#0F172A]/30 uppercase">Scroll</span>
          <ChevronDown className="w-4 h-4 text-[#0F172A]/25 animate-bounce" />
        </div>
      </section>

      {/* ── Interactive product showcase ─────────────────────────────────────── */}
      <section ref={showcaseRef} className="w-full max-w-[1200px] mx-auto px-6 lg:px-12 mb-32">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold tracking-[0.22em] text-[#0F172A]/40 uppercase">Inside AlphaMap</span>
          <h2
            className="mt-3 text-3xl md:text-4xl font-normal text-[#111827] tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            One workspace for every side of the market
          </h2>
        </div>

        <div
          className="rounded-[28px] border border-gray-200/80 p-2 sm:p-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
          style={{ background: "linear-gradient(180deg, #EEF1F4 0%, #E4E9ED 100%)" }}
        >
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-1 pt-1 pb-2 overflow-x-auto">
            {SHOWCASE_TABS.map((tab) => {
              const active = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  onClick={() => handleTabClick(tab.key)}
                  className={`relative flex-none px-4 py-2.5 text-sm font-semibold rounded-xl transition-all whitespace-nowrap ${
                    active ? "bg-white text-[#0F172A] shadow-sm" : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {tab.label}
                  {active && <span className="absolute left-4 right-4 -bottom-[1px] h-[2px] rounded-full bg-[#0F172A]" />}
                </button>
              );
            })}
          </div>

          {/* Window — fixed size so switching tabs never resizes the card */}
          <div className="rounded-[22px] bg-white border border-gray-100 p-6 sm:p-10 h-[600px] sm:h-[520px] flex flex-col overflow-hidden">
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
                    Loading {SHOWCASE_TABS.find((t) => t.key === activeTab)?.label}…
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
      <UseCasesSection />

      {/* ── Final CTA ────────────────────────────────────────────────────────── */}
      <section className="w-full max-w-[1000px] mx-auto px-6 lg:px-12 pb-32 pt-16">
        <div className="bg-white rounded-[32px] p-12 md:p-24 shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col items-center text-center">
          <h2
            className="text-4xl md:text-5xl text-[#111827] font-medium tracking-tight mb-8"
            style={{ fontFamily: "'Playfair Display', serif", lineHeight: "1.2" }}
          >
            Are you ready to see the full picture?
          </h2>
          <button className="rounded-full bg-[#F59E0B] px-10 py-4 text-base font-semibold text-white shadow-[0_4px_14px_0_rgba(245,158,11,0.39)] transition-all hover:bg-amber-600 hover:shadow-[0_6px_20px_rgba(245,158,11,0.23)] hover:-translate-y-0.5">
            Request Early Access
          </button>
        </div>
      </section>

    </div>
  );
}
