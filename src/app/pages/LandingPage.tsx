import React from 'react';
import { HeroMap } from '../components/HeroMap';
import { Network, Brain, Map } from 'lucide-react';
import { useNavigate } from 'react-router';

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F3F4F6] font-sans overflow-x-hidden selection:bg-[#F59E0B]/10 selection:text-[#111827]">
      
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-50 flex h-24 w-full items-center justify-between px-6 lg:px-12">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0F172A] shadow-sm">
            <svg 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="#FFFFFF" 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="w-[18px] h-[18px]"
            >
              {/* Continuous Alpha Symbol Flowing into Upward Arrow */}
              <path d="M15 8 C12 8 9 12 7 15 A4 4 0 1 1 8 8 C11 8 14 13 16 16 C17.5 18 19 12 20 6" />
              <polyline points="15 6 20 6 20 11" />
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight text-[#0F172A]">
            AlphaMap
          </span>
        </div>
        <div className="flex items-center gap-6">
          <button className="text-sm font-medium text-gray-500 hover:text-[#111827] transition-colors">Log In</button>
          <button 
            onClick={() => navigate('/dashboard')}
            className="rounded-full bg-white border border-gray-200 px-5 py-2.5 text-sm font-medium text-[#111827] shadow-sm hover:shadow-md transition-all duration-200"
          >
            View Dashboard
          </button>
        </div>
      </header>

      {/* 1. Hero Section (Centered) */}
      <section className="pt-36 lg:pt-48 pb-12 px-6 lg:px-12 w-full max-w-[1200px] mx-auto text-center relative z-10">
        <h1 
          className="text-4xl sm:text-5xl md:text-6xl lg:text-[4.5rem] text-[#111827] font-medium tracking-tight mb-8 drop-shadow-sm mx-auto max-w-5xl"
          style={{ 
            fontFamily: "'Playfair Display', serif", 
            lineHeight: "1.15"
          }}
        >
          Bridging the Gap between Private Innovation and Public Markets
        </h1>
        
        <p className="text-lg md:text-xl text-gray-500 leading-relaxed max-w-3xl mx-auto font-sans font-medium">
          The first platform that integrates Stocks, VC, Startup, and Hedge Fund data into a single, unified intelligence layer.
        </p>
      </section>

      {/* 2. Interactive Pulse (Centered Map) */}
      <section className="relative w-full max-w-[1400px] mx-auto mb-20 px-4 flex justify-center">
        <div className="w-full lg:w-4/5">
          <HeroMap />
        </div>
      </section>

      {/* 3. Data Proof Points (Centered Row) */}
      <section className="w-full max-w-[1200px] mx-auto px-6 lg:px-12 mb-32">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          {[
            { label: '+10M Startups Tracked', value: '+10M' },
            { label: '+5k VC Funds Monitored', value: '+5k' },
            { label: '+2M Public Stocks', value: '+2M' },
            { label: '+1k Hedge Fund Profiles', value: '+1k' },
          ].map((point, i) => (
            <div 
              key={i} 
              className="bg-white rounded-[24px] p-8 shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col items-center justify-center text-center transition-transform hover:-translate-y-1 duration-300"
            >
              <span className="text-4xl md:text-[2.5rem] font-bold text-[#111827] mb-2 font-sans tracking-tight">{point.value}</span>
              <span className="text-sm font-medium text-gray-500 font-sans">{point.label.replace(point.value, '').trim()}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Core Intelligence Features (Centered Grid) */}
      <section className="w-full max-w-[1200px] mx-auto px-6 lg:px-12 mb-32">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {/* Card 1 */}
          <div className="bg-white rounded-[24px] p-8 md:p-10 shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col items-center text-center transition-all hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)]">
            <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center text-[#F59E0B] mb-8">
              <Network className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-[#111827] mb-4 font-sans">Cross-Market Correlation</h3>
            <p className="text-gray-500 leading-relaxed font-medium font-sans">
              Discover hidden links between private funding rounds and public stock movements.
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-white rounded-[24px] p-8 md:p-10 shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col items-center text-center transition-all hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)]">
            <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center text-[#F59E0B] mb-8">
              <Brain className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-[#111827] mb-4 font-sans">AI-Powered Narratives</h3>
            <p className="text-gray-500 leading-relaxed font-medium font-sans">
              Translate raw data into clear, actionable intelligence and business stories.
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-white rounded-[24px] p-8 md:p-10 shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col items-center text-center transition-all hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)]">
            <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center text-[#F59E0B] mb-8">
              <Map className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-[#111827] mb-4 font-sans">Capital Flow Visualization</h3>
            <p className="text-gray-500 leading-relaxed font-medium font-sans">
              Track where leading investors are moving their money across private and public sectors.
            </p>
          </div>
        </div>
      </section>

      {/* 5. Final CTA (Centered) */}
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
