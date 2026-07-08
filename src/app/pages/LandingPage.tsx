import React, { useState, useEffect } from "react";
import { Network, Brain, Map, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router";

// ── Hero typewriter copy ─────────────────────────────────────────────────────
const HEADLINE = "Bridging the Gap between Private Innovation and Public Markets.";
const SUBHEAD  = "An AI-driven investment research platform that transforms global market data into a clear strategy.";
const TYPE_START_DELAY_MS = 400;
const TYPE_SPEED_MS       = 45;

export function LandingPage() {
  const navigate     = useNavigate();
  const [scrolled,   setScrolled]   = useState(false);
  const [typedCount, setTypedCount] = useState(0);
  const doneTyping = typedCount >= HEADLINE.length;

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

  // Fade-up for the subheading, once the headline finishes typing
  function tx(delayMs: number): React.CSSProperties {
    return {
      opacity:    doneTyping ? 1 : 0,
      transform:  doneTyping ? "translateY(0)" : "translateY(14px)",
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
        className="relative w-full flex flex-col items-center justify-center text-center px-6"
        style={{ minHeight: "100svh", background: "linear-gradient(180deg, #FAFAF9 0%, #F3F4F6 100%)" }}
      >
        <div className="flex justify-center mb-10">
          <div className="h-px w-16" style={{ background: "linear-gradient(90deg, transparent, #F59E0B, transparent)" }} />
        </div>

        <h1
          className="max-w-[1100px] text-[2.4rem] sm:text-5xl md:text-[3.8rem] lg:text-[4.6rem] font-medium text-[#111827] tracking-tight"
          style={{ fontFamily: "'Playfair Display', serif", lineHeight: "1.15" }}
        >
          {HEADLINE.slice(0, typedCount)}
          <span className="typewriter-cursor" aria-hidden="true" />
        </h1>

        <p
          className="max-w-[720px] mt-8 text-xl md:text-2xl leading-relaxed font-medium text-[#374151]"
          style={tx(150)}
        >
          {SUBHEAD}
        </p>

        {/* Scroll indicator */}
        <div
          style={tx(500)}
          className="absolute bottom-9 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 pointer-events-none"
        >
          <span className="text-[9px] font-semibold tracking-[0.32em] text-[#0F172A]/30 uppercase">Scroll</span>
          <ChevronDown className="w-4 h-4 text-[#0F172A]/25 animate-bounce" />
        </div>
      </section>

      {/* ── Data proof points ───────────────────────────────────────────────── */}
      <section className="w-full max-w-[1200px] mx-auto px-6 lg:px-12 mb-32">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          {[
            { label: "Startups Tracked",     value: "+10M" },
            { label: "VC Funds Monitored",   value: "+5k"  },
            { label: "Public Stocks",         value: "+2M"  },
            { label: "Hedge Fund Profiles",   value: "+1k"  },
          ].map((point) => (
            <div
              key={point.label}
              className="rounded-[24px] p-8 flex flex-col items-center justify-center text-center transition-transform hover:-translate-y-1 duration-300"
              style={{ background: "#0F172A", boxShadow: "0 8px 30px rgba(0,0,0,0.18)" }}
            >
              <span className="text-4xl md:text-[2.5rem] font-bold text-white mb-2 tracking-tight">{point.value}</span>
              <span className="text-sm font-medium text-slate-400">{point.label}</span>
            </div>
          ))}
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
