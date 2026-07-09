import React, { useState, useEffect, useMemo, useRef } from "react";
import { Network, Brain, Map, ChevronDown, Sparkles, TrendingUp, Loader2 } from "lucide-react";
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
  "Growth":   "bg-amber-50 border-amber-200 text-amber-700",
};

const SHOWCASE_TABS: { key: string; label: string }[] = [
  { key: "startups", label: "Startups" },
  { key: "deals",    label: "Deal Flow" },
  { key: "sourcing", label: "AI Sourcing" },
  { key: "vcs",      label: "VC Directory" },
];

const DEAL_ROWS = [
  { company: "Cortex Analytics", logo: "C", color: "#0F172A", type: "Series A", size: "$38M",  leads: "Meridian Partners", valuation: "$310M", estimated: false },
  { company: "Fathom Robotics",  logo: "F", color: "#2563EB", type: "Seed",     size: "$6.2M", leads: "Northbeam Capital", valuation: "$42M",  estimated: true  },
  { company: "Vantage Health",   logo: "V", color: "#059669", type: "Series B", size: "$85M",  leads: "Ridgeline Growth",  valuation: "$640M", estimated: false },
  { company: "Loop Freight",     logo: "L", color: "#B45309", type: "Seed",     size: "$4.8M", leads: "Anchor Point VC",   valuation: "$28M",  estimated: true  },
];

const SOURCING_ROWS = [
  { company: "Artisan Systems",  match: 96, momentum: 92, sector: "B2B",      tag2: "Outbound",     stage: "Series A" },
  { company: "Sparro AI",        match: 93, momentum: 88, sector: "B2B",      tag2: "Inbound",      stage: "Seed"     },
  { company: "Fathom Robotics",  match: 90, momentum: 84, sector: "Robotics", tag2: "Hardware",     stage: "Seed"     },
  { company: "Jeeva Logic",      match: 87, momentum: 81, sector: "SaaS",     tag2: "Multichannel", stage: "Series A" },
];

const VC_ROWS = [
  { name: "Meridian Partners", stages: ["Seed", "Series A"],    aum: "$1.4B", portfolio: 62 },
  { name: "Ridgeline Growth",  stages: ["Series B", "Growth"],  aum: "$3.2B", portfolio: 41 },
  { name: "Anchor Point VC",   stages: ["Pre-Seed", "Seed"],    aum: "$420M", portfolio: 88 },
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

function StartupsShowcase() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
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
  }, []);

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
        <div className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-base flex-none" style={{ background: "#0F172A" }}>A</div>
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
function DealsShowcase() {
  return (
    <div className="flex flex-col h-full">
      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">Deal Flow</span>
      <h3 className="text-2xl font-bold text-[#111827] mt-2 mb-1 flex-none">Every private round, tracked in real time</h3>
      <p className="text-sm text-gray-400 mb-6 max-w-lg flex-none">From seed checks to late-stage megarounds — sourced, verified, and structured the moment they close.</p>

      <div className="overflow-x-auto -mx-1 flex-1 min-h-0">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
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
                <td className="py-3 px-1">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-none" style={{ background: row.color }}>{row.logo}</div>
                    <span className="font-semibold text-[#111827] whitespace-nowrap">{row.company}</span>
                  </div>
                </td>
                <td className="py-3 px-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[row.type]}`}>{row.type}</span>
                </td>
                <td className="py-3 px-1 font-medium text-[#111827] whitespace-nowrap">{row.size}</td>
                <td className="py-3 px-1 text-gray-500 whitespace-nowrap">{row.leads}</td>
                <td className="py-3 px-1 text-right">
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
function SourcingShowcase() {
  return (
    <div className="flex flex-col h-full">
      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">Company Sourcing</span>
      <h3 className="text-2xl font-bold text-[#111827] mt-2 mb-1 flex-none">Find your next investment</h3>
      <p className="text-sm text-gray-400 mb-6 flex-none">Search across startups, VCs, and deals in plain English.</p>

      <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 px-4 py-3 mb-6 flex-none">
        <Sparkles className="w-4 h-4 text-[#0F172A]/40 flex-none" />
        <span className="text-sm text-[#111827] font-medium">
          Early-stage fintech infra in Europe
          <span className="typewriter-cursor" aria-hidden="true" />
        </span>
        <button className="ml-auto flex-none rounded-full bg-[#0F172A] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#1e293b] transition-colors">Ask</button>
      </div>

      <div className="overflow-x-auto -mx-1 flex-1 min-h-0">
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
            {SOURCING_ROWS.map((row) => (
              <tr key={row.company} className="border-b border-gray-50 last:border-0">
                <td className="py-3 px-1 font-semibold text-[#111827] whitespace-nowrap">{row.company}</td>
                <td className="py-3 px-1">
                  <span className="inline-flex items-center justify-center min-w-[34px] px-1.5 py-0.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 font-bold text-xs">{row.match}</span>
                </td>
                <td className="py-3 px-1">
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold text-xs">
                    <TrendingUp className="w-3 h-3" />{row.momentum}
                  </span>
                </td>
                <td className="py-3 px-1">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 mr-1 whitespace-nowrap">{row.sector}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 hidden sm:inline-block whitespace-nowrap">{row.tag2}</span>
                </td>
                <td className="py-3 px-1 text-right">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STAGE_STYLES[row.stage]}`}>{row.stage}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── VC Directory tab ──────────────────────────────────────────────────────────
function VCsShowcase() {
  return (
    <div className="flex flex-col h-full">
      <span className="text-[11px] font-bold tracking-[0.14em] text-[#0F172A]/45 uppercase flex-none">VC Directory</span>
      <h3 className="text-2xl font-bold text-[#111827] mt-2 mb-1 flex-none">Every fund that matters, in one view</h3>
      <p className="text-sm text-gray-400 mb-6 max-w-lg flex-none">Stage focus, sector concentration, and portfolio activity — normalized across 5,000+ firms.</p>

      <div className="grid sm:grid-cols-3 gap-4 flex-1 min-h-0">
        {VC_ROWS.map((vc) => (
          <div key={vc.name} className="rounded-2xl border border-gray-100 bg-gray-50/60 p-5">
            <p className="font-bold text-[#111827] mb-2">{vc.name}</p>
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
          </div>
        ))}
      </div>
    </div>
  );
}

const SHOWCASE_CONTENT: Record<string, React.ComponentType> = {
  startups: StartupsShowcase,
  deals:    DealsShowcase,
  sourcing: SourcingShowcase,
  vcs:      VCsShowcase,
};

export function LandingPage() {
  const navigate        = useNavigate();
  const [scrolled,      setScrolled]      = useState(false);
  const [typedCount,    setTypedCount]    = useState(0);
  const [subTypedCount, setSubTypedCount] = useState(0);
  const [activeTab,     setActiveTab]     = useState("startups"); // tab bar highlight (target)
  const [displayTab,    setDisplayTab]    = useState("startups"); // tab actually rendered
  const [tabLoading,    setTabLoading]    = useState(false);
  const tabSwitchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    <div className="min-h-screen bg-[#F3F4F6] font-sans overflow-x-hidden selection:bg-amber-400/10">

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
      <section className="w-full max-w-[1200px] mx-auto px-6 lg:px-12 mb-32">
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
                  return <TabContent />;
                })()
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature cards ───────────────────────────────────────────────────── */}
      <section className="w-full max-w-[1200px] mx-auto px-6 lg:px-12 mb-32">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {[
            {
              icon: Network,
              title: "Cross-Market Correlation",
              body:  "Discover hidden links between private funding rounds and public stock movements.",
            },
            {
              icon: Brain,
              title: "AI-Powered Narratives",
              body:  "Translate raw data into clear, actionable intelligence and business stories.",
            },
            {
              icon: Map,
              title: "Capital Flow Visualization",
              body:  "Track where leading investors are moving their money across private and public sectors.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-[24px] p-8 md:p-10 flex flex-col items-center text-center transition-transform hover:-translate-y-1 duration-300"
              style={{ background: "#0F172A", boxShadow: "0 8px 30px rgba(0,0,0,0.18)" }}
            >
              <div className="h-14 w-14 rounded-2xl flex items-center justify-center mb-8"
                style={{ background: "rgba(245,158,11,0.15)" }}>
                <Icon className="w-6 h-6" style={{ color: "#F59E0B" }} />
              </div>
              <h3 className="text-xl font-bold text-white mb-4">{title}</h3>
              <p className="leading-relaxed font-medium" style={{ color: "#94a3b8" }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

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
