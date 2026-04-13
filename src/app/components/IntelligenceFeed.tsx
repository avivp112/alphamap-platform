import React from 'react';
import { Sparkles, AlertCircle, TrendingUp, BarChart2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function IntelligenceFeed() {
  const feedItems = [
    {
      type: 'Alert',
      icon: AlertCircle,
      title: 'VC funding in AI chips spikes 40%',
      description: 'Major influx of capital observed in Q3 for silicon startups focused on large language models.',
      time: '10 min ago',
      color: 'text-[#F59E0B]',
      bg: 'bg-amber-50',
    },
    {
      type: 'Correlation',
      icon: TrendingUp,
      title: 'Softbank exits Alibaba, reduces tech exposure',
      description: 'Historical data suggests this move often precedes a broader shift towards safe-haven assets.',
      time: '2 hrs ago',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      type: 'Insight',
      icon: Sparkles,
      title: 'Retail sentiment turning bearish on EVs',
      description: 'Social listening metrics show a 15% decline in positive sentiment for top 3 EV manufacturers this week.',
      time: '5 hrs ago',
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
    },
    {
      type: 'Data Anomaly',
      icon: BarChart2,
      title: 'Unusual options volume in Mid-Cap Pharma',
      description: 'Call options volume exceeding 90-day average by 300% on select biotech tickers.',
      time: '1 day ago',
      color: 'text-rose-600',
      bg: 'bg-rose-50',
    },
  ];

  return (
    <div className="flex h-full flex-col rounded-2xl border border-gray-100 bg-white shadow-sm p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#F59E0B]" />
          <h2 className="text-lg font-bold text-[#111827]">Intelligence Feed</h2>
        </div>
        <span className="rounded-full bg-[#111827] px-2.5 py-0.5 text-xs font-medium text-white shadow-sm">
          Live AI
        </span>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto pr-2">
        {feedItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <div 
              key={index} 
              className="group relative flex flex-col gap-2 rounded-xl border border-gray-100 bg-white p-4 transition-all duration-200 hover:border-[#F59E0B]/30 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", item.color, item.bg)}>
                  <Icon className="h-3 w-3" />
                  {item.type}
                </span>
                <span className="text-xs font-medium text-gray-400">{item.time}</span>
              </div>
              
              <h3 className="text-sm font-semibold text-[#111827] leading-snug mt-1 group-hover:text-[#F59E0B] transition-colors">
                {item.title}
              </h3>
              
              <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                {item.description}
              </p>
            </div>
          );
        })}
      </div>
      
      <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#F3F4F6] py-3 text-sm font-semibold text-[#111827] transition-colors hover:bg-gray-200">
        Load More Insights
      </button>
    </div>
  );
}
