import React from 'react';
import { ArrowRight, Sparkles, AlertTriangle, Lightbulb, TrendingUp, BarChart, Compass } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function AIMarketStory() {
  return (
    <div className="relative overflow-hidden rounded-[10px] bg-[#0F172A] p-6 sm:p-8 md:p-10 shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[#1E293B]">
      {/* Background Decor */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-amber-500/10 rounded-full blur-[60px] translate-y-1/2 -translate-x-1/2" />

      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 backdrop-blur-md">
            <Sparkles className="h-4 w-4 text-[#FDFD01]" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-gray-300">AI Market Story</span>
        </div>

        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight mb-8 max-w-3xl">
          "Capital rotates from consumer tech into AI infrastructure as VC funding spikes +40% in silicon startups."
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="flex flex-col gap-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Key Drivers</h3>
            <ul className="flex flex-col gap-3">
              <li className="flex items-start gap-3">
                <div className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <p className="text-sm font-medium text-gray-300"><strong className="text-white">VCs:</strong> Aggressive late-stage capital deployment into AI hardware.</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <p className="text-sm font-medium text-gray-300"><strong className="text-white">Startups:</strong> Enterprise AI adoption driving 3x revenue multiples.</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-400" />
                <p className="text-sm font-medium text-gray-300"><strong className="text-white">Hedge Funds:</strong> Reducing long exposure to legacy software names.</p>
              </li>
            </ul>
          </div>
          
          <div className="flex flex-col justify-between rounded-lg bg-white/5 border border-white/10 p-5 backdrop-blur-sm">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">What it means for you</h3>
              <p className="text-sm font-medium text-gray-200 leading-relaxed">
                Expect near-term volatility in mid-cap consumer tech while semi-conductor and AI infrastructure equities experience sustained inflows.
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                <TrendingUp className="h-3 w-3" /> Growth Opportunity
              </span>
              <button className="text-xs font-bold text-[#FDFD01] hover:text-white transition-colors flex items-center gap-1">
                View Trade Ideas <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CrossMarketSignalsBar() {
  const signals = [
    { label: 'VC funding spike in Semi-conductors', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { label: 'Hedge funds rotating out of SaaS', icon: Compass, color: 'text-rose-500', bg: 'bg-rose-50' },
    { label: 'Startup hiring surge in AI/ML', icon: BarChart, color: 'text-indigo-500', bg: 'bg-indigo-50' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      {signals.map((signal, idx) => {
        const Icon = signal.icon;
        return (
          <button 
            key={idx}
            className="group flex items-center gap-3 rounded-[8px] border border-gray-100 bg-white px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-gray-200 transition-all duration-200 flex-1 sm:flex-none"
          >
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", signal.bg)}>
              <Icon className={cn("h-4 w-4", signal.color)} />
            </div>
            <span className="text-xs font-bold text-[#0F172A] text-left group-hover:text-blue-600 transition-colors line-clamp-1">
              {signal.label}
            </span>
            <ArrowRight className="h-4 w-4 text-gray-300 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        );
      })}
    </div>
  );
}

export function PortfolioInsight() {
  return (
    <div className="rounded-[10px] border border-gray-100 bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.02)]">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F59E0B]/10">
          <Lightbulb className="h-5 w-5 text-[#F59E0B]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[#0F172A]">Portfolio Insights</h3>
          <p className="text-xs font-medium text-gray-500 mt-0.5">Automated Risk & Exposure</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-[8px] border border-gray-100 p-4 bg-gray-50/50 hover:bg-white hover:shadow-sm transition-all duration-200">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-[#F59E0B]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#0F172A]">High AI Exposure</span>
          </div>
          <p className="text-sm font-medium text-gray-500 leading-relaxed">
            Your portfolio is 32% exposed to AI infrastructure, which correlates highly with recent VC inflows.
          </p>
        </div>
        
        <div className="rounded-[8px] border border-gray-100 p-4 bg-gray-50/50 hover:bg-white hover:shadow-sm transition-all duration-200">
          <div className="flex items-center gap-2 mb-2">
            <Compass className="h-4 w-4 text-rose-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#0F172A]">Risk Dependency</span>
          </div>
          <p className="text-sm font-medium text-gray-500 leading-relaxed">
            Overweight in legacy SaaS. Consider rebalancing as hedge funds rotate towards newer tech cycles.
          </p>
        </div>
      </div>
      
      <button className="mt-6 flex w-full justify-center items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#0F172A] hover:text-blue-600 transition-colors">
        Analyze Full Portfolio <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}
