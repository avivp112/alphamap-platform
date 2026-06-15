import React, { useState, useEffect, useRef, useCallback } from "react";
import { Network, Brain, Map, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router";

// ── Timing ─────────────────────────────────────────────────────────────────────
// Adjust GRAPH_APPEAR_TIME to the exact second in your video when the financial
// graphs start expanding across the screen.  The headline will fade in at that
// precise moment.  Set to 0 to reveal text immediately.
const GRAPH_APPEAR_TIME = 3.2; // seconds
const FALLBACK_DELAY_MS = 6000; // show text anyway if autoplay is blocked

export function LandingPage() {
  const navigate    = useNavigate();
  const videoRef    = useRef<HTMLVideoElement>(null);
  const [textVisible, setTextVisible] = useState(false);
  const [scrolled,    setScrolled]    = useState(false);

  // Header: switch from glass-over-dark to opaque-light after hero scrolls past
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Fallback reveal (autoplay blocked, video slow to load, etc.)
  useEffect(() => {
    const t = setTimeout(() => setTextVisible(true), FALLBACK_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // Precise sync: reveal exactly when video reaches the graph expansion moment
  const handleTimeUpdate = useCallback(() => {
    if (!textVisible && videoRef.current && videoRef.current.currentTime >= GRAPH_APPEAR_TIME) {
      setTextVisible(true);
    }
  }, [textVisible]);

  // Staggered fade-up: each element gets its own delay offset
  function tx(delayMs: number): React.CSSProperties {
    return {
      opacity:    textVisible ? 1 : 0,
      transform:  textVisible ? "translateY(0)" : "translateY(28px)",
      transition: `opacity 1100ms ease-out ${delayMs}ms, transform 1100ms ease-out ${delayMs}ms`,
    };
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6] font-sans overflow-x-hidden selection:bg-amber-400/10">

      {/* ── Fixed header ─────────────────────────────────────────────────────── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 flex h-20 w-full items-center justify-between px-6 lg:px-12"
        style={{
          background:    scrolled ? "rgba(255,255,255,0.94)" : "transparent",
          backdropFilter:scrolled ? "blur(14px)"             : "none",
          borderBottom:  scrolled ? "1px solid rgba(0,0,0,0.07)" : "none",
          boxShadow:     scrolled ? "0 2px 20px rgba(0,0,0,0.06)" : "none",
          transition:    "background 400ms ease, backdrop-filter 400ms ease, border-color 400ms ease, box-shadow 400ms ease",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: "#0F172A", boxShadow: scrolled ? "none" : "0 0 0 1px rgba(255,255,255,0.12)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
              <path d="M15 8 C12 8 9 12 7 15 A4 4 0 1 1 8 8 C11 8 14 13 16 16 C17.5 18 19 12 20 6" />
              <polyline points="15 6 20 6 20 11" />
            </svg>
          </div>
          <span
            className="text-xl font-bold tracking-tight"
            style={{ color: scrolled ? "#0F172A" : "#ffffff", transition: "color 400ms ease" }}
          >
            AlphaMap
          </span>
        </div>

        {/* Nav */}
        <div className="flex items-center gap-5">
          <button
            className="text-sm font-medium transition-colors duration-300"
            style={{ color: scrolled ? "#6b7280" : "rgba(255,255,255,0.60)" }}
            onMouseEnter={e => (e.currentTarget.style.color = scrolled ? "#111827" : "#fff")}
            onMouseLeave={e => (e.currentTarget.style.color = scrolled ? "#6b7280" : "rgba(255,255,255,0.60)")}
          >
            Log In
          </button>
          <button
            onClick={() => navigate("/dashboard")}
            className="rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-300"
            style={scrolled ? {
              background: "#fff", border: "1px solid rgba(0,0,0,0.11)",
              color: "#111827", boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
            } : {
              background: "rgba(255,255,255,0.11)", border: "1px solid rgba(255,255,255,0.22)", color: "#fff",
            }}
            onMouseEnter={e => { if (!scrolled) e.currentTarget.style.background = "rgba(255,255,255,0.20)"; }}
            onMouseLeave={e => { if (!scrolled) e.currentTarget.style.background = "rgba(255,255,255,0.11)"; }}
          >
            View Dashboard
          </button>
        </div>
      </header>

      {/* ── Full-screen video hero ────────────────────────────────────────────── */}
      <section
        className="relative w-full overflow-hidden"
        style={{ height: "100svh", minHeight: "640px" }}
      >
        {/* Background video — muted + playsInline required for autoplay on all browsers */}
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onTimeUpdate={handleTimeUpdate}
          className="absolute inset-0 w-full h-full object-cover"
          src="/hero-bg-clean.mp4"
        />

        {/* Cinematic overlay system
            Layer 1: uniform base darkening
            Layer 2: vignette (darker edges, bright centre draws focus to text)
            Layer 3: top / bottom gradients for header and scroll-indicator legibility */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: [
              "rgba(4,10,22,0.30)",                                                                     // base
              "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 25%, rgba(0,0,0,0.48) 100%)",         // vignette
              "linear-gradient(to bottom, rgba(4,10,22,0.55) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 55%, rgba(4,10,22,0.75) 100%)", // top + bottom
            ].join(", "),
          }}
        />

        {/* Hero content — single CTA centred over video */}
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          <div style={tx(0)}>
            <button
              className="rounded-full px-9 py-4 text-[15px] font-semibold text-white"
              style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.26)", transition: "background 200ms ease" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.10)")}
            >
              Request Early Access
            </button>
          </div>
        </div>

        {/* Scroll indicator — staggered last */}
        <div
          style={tx(700)}
          className="absolute bottom-9 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 pointer-events-none"
        >
          <span className="text-[9px] font-semibold tracking-[0.32em] text-white/30 uppercase">Scroll</span>
          <ChevronDown className="w-4 h-4 text-white/25 animate-bounce" />
        </div>
      </section>

      {/* ── Caption ──────────────────────────────────────────────────────────── */}
      <section className="w-full max-w-[820px] mx-auto px-6 lg:px-12 pt-20 pb-16 text-center">
        <div className="flex justify-center mb-10">
          <div className="h-px w-16" style={{ background: "linear-gradient(90deg, transparent, #F59E0B, transparent)" }} />
        </div>
        <h1
          className="text-[2.4rem] sm:text-5xl md:text-[3.6rem] font-medium text-[#111827] tracking-tight mb-8"
          style={{ fontFamily: "'Playfair Display', serif", lineHeight: "1.1" }}
        >
          Bridging the Gap between
          <br className="hidden sm:block" />
          {" "}Private Innovation
          <br className="hidden sm:block" />
          {" "}and Public Markets
        </h1>
        <p
          className="text-xl md:text-2xl leading-relaxed font-medium"
          style={{ color: "#374151", fontFamily: "'Playfair Display', serif", lineHeight: "1.6" }}
        >
          The first platform that integrates{" "}
          <span style={{ color: "#111827", fontWeight: 600 }}>Stocks, VC, Startup, and Hedge Fund data</span>{" "}
          into a single, unified intelligence layer.
        </p>
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
              className="bg-white rounded-[24px] p-8 shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col items-center justify-center text-center transition-transform hover:-translate-y-1 duration-300"
            >
              <span className="text-4xl md:text-[2.5rem] font-bold text-[#111827] mb-2 tracking-tight">{point.value}</span>
              <span className="text-sm font-medium text-gray-500">{point.label}</span>
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
              className="bg-white rounded-[24px] p-8 md:p-10 shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col items-center text-center transition-all hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)]"
            >
              <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center text-[#F59E0B] mb-8">
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-[#111827] mb-4">{title}</h3>
              <p className="text-gray-500 leading-relaxed font-medium">{body}</p>
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
