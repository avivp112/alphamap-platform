import React from 'react';
import { Sparkles, AlertCircle, TrendingUp, BarChart2, Zap, Target, Activity } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function IntelligenceFeed() {
  const feedItems = [
    {
      type: 'Signal',
      icon: Activity,
      title: 'VC funding in AI chips spikes 40%',
      description: 'Major capital influx observed in Q3 for silicon startups focused on LLM optimization.',
      time: '10 min ago',
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      trend: 'up' as const,
    },
    {
      type: 'Correlation',
      icon: Zap,
      title: 'Hedge funds rotating from EVs to AI',
      description: 'Historical pattern suggests a broad shift towards early-stage AI infrastructure.',
      time: '2 hrs ago',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      trend: 'up' as const,
    },
    {
      type: 'Risk',
      icon: AlertCircle,
      title: 'Retail sentiment turning bearish on auto',
      description: 'Social listening metrics show 15% decline in positive sentiment for top 3 manufacturers.',
      time: '5 hrs ago',
      color: 'text-rose-600',
      bg: 'bg-rose-50',
      trend: 'down' as const,
    },
    {
      type: 'Opportunity',
      icon: Target,
      title: 'Unusual volume in Mid-Cap Pharma',
      description: 'Call options volume exceeding 90-day average by 300% on select biotech tickers.',
      time: '1 day ago',
      color: 'text-[#F59E0B]',
      bg: 'bg-amber-50',
      trend: 'up' as const,
    },
  ];

  return (
    <div className="flex h-full flex-col rounded-[24px] border border-gray-100 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.02)] p-6 md:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F172A] shadow-sm">
            <Sparkles className="h-5 w-5 text-[#FDFD01]" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#0F172A]">AI Signals Feed</h2>
            <p className="text-xs font-medium text-gray-500 mt-0.5">Real-time cross-market alerts</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto pr-2">
        {feedItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <div 
              key={index} 
              className="group relative flex flex-col gap-3 rounded-[20px] border border-gray-100 bg-white p-5 transition-all duration-300 hover:border-gray-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]"
            >
              <div className="flex items-center justify-between">
                <span className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", item.color, item.bg)}>
                  <Icon className="h-3 w-3" />
                  {item.type}
                </span>
                <div className="flex items-center gap-3">
                  {item.trend === 'up' ? (
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-rose-500" />
                  )}
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{item.time}</span>
                </div>
              </div>
              
              <div>
                <h3 className="text-[15px] font-bold text-[#0F172A] leading-snug group-hover:text-[#F59E0B] transition-colors">
                  {item.title}
                </h3>
                
                <p className="text-sm font-medium text-gray-500 line-clamp-2 leading-relaxed mt-1">
                  {item.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      
      <button className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#F3F4F6] py-3.5 text-sm font-bold tracking-wide text-[#0F172A] transition-colors hover:bg-gray-200">
        Load More Signals
      </button>
    </div>
  );
}
