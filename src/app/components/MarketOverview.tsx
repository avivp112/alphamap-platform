import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Network, Target, Building2, Briefcase } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function MarketMap() {
  const nodes = [
    { id: 'vc', label: 'Venture Capital', x: 20, y: 30, icon: Target, trend: 'up' as const, value: '+4.2%' },
    { id: 'startups', label: 'Startups', x: 20, y: 70, icon: Network, trend: 'up' as const, value: '+8.1%' },
    { id: 'public', label: 'Public Markets', x: 80, y: 30, icon: Building2, trend: 'down' as const, value: '-1.5%' },
    { id: 'hedge', label: 'Hedge Funds', x: 80, y: 70, icon: Briefcase, trend: 'up' as const, value: '+2.4%' },
  ];

  const flows = [
    { source: 'vc', target: 'startups', active: true, color: '#10B981' }, // Green
    { source: 'startups', target: 'public', active: false, color: '#10B981' },
    { source: 'public', target: 'hedge', active: true, color: '#EF4444' }, // Red flow
    { source: 'hedge', target: 'vc', active: false, color: '#10B981' },
    { source: 'hedge', target: 'startups', active: true, color: '#10B981' },
  ];

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  return (
    <div className="relative h-80 w-full overflow-hidden rounded-[24px] border border-gray-100 bg-white mb-6 flex items-center justify-center shadow-sm">
      <div className="absolute inset-0 z-0">
        <svg className="h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="flow-green" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0" />
              <stop offset="50%" stopColor="#10B981" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="flow-red" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#EF4444" stopOpacity="0" />
              <stop offset="50%" stopColor="#EF4444" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
            </linearGradient>
            
            <filter id="glow-green">
              <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            
            <filter id="glow-red">
              <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* Base Lines */}
          {flows.map((flow, i) => {
            const sourceNode = nodes.find(n => n.id === flow.source)!;
            const targetNode = nodes.find(n => n.id === flow.target)!;
            return (
              <line
                key={`base-${i}`}
                x1={`${sourceNode.x}%`}
                y1={`${sourceNode.y}%`}
                x2={`${targetNode.x}%`}
                y2={`${targetNode.y}%`}
                stroke="#F3F4F6"
                strokeWidth="0.5"
              />
            );
          })}

          {/* Active Flow Lines */}
          {flows.filter(f => f.active).map((flow, i) => {
            const sourceNode = nodes.find(n => n.id === flow.source)!;
            const targetNode = nodes.find(n => n.id === flow.target)!;
            const isGreen = flow.color === '#10B981';
            return (
              <line
                key={`flow-${i}`}
                x1={`${sourceNode.x}%`}
                y1={`${sourceNode.y}%`}
                x2={`${targetNode.x}%`}
                y2={`${targetNode.y}%`}
                stroke={isGreen ? "rgba(16, 185, 129, 0.8)" : "rgba(239, 68, 68, 0.8)"}
                strokeWidth="2"
                strokeDasharray="6 6"
                className="animate-[dash_2s_linear_infinite]"
                filter={isGreen ? "url(#glow-green)" : "url(#glow-red)"}
              />
            );
          })}
        </svg>
      </div>

      <style>{`
        @keyframes dash {
          to {
            stroke-dashoffset: -20;
          }
        }
      `}</style>

      {/* Nodes */}
      {nodes.map((node) => {
        const Icon = node.icon;
        const isHovered = hoveredNode === node.id;
        const isUp = node.trend === 'up';

        return (
          <div
            key={node.id}
            onMouseEnter={() => setHoveredNode(node.id)}
            onMouseLeave={() => setHoveredNode(null)}
            className="absolute z-10 flex flex-col items-center justify-center transition-transform duration-300 ease-in-out cursor-pointer"
            style={{ left: `${node.x}%`, top: `${node.y}%`, transform: `translate(-50%, -50%) ${isHovered ? 'scale(1.1)' : 'scale(1)'}` }}
          >
            <div className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] border transition-colors duration-300",
              isHovered ? "border-[#0F172A]" : "border-gray-100"
            )}>
              <Icon className={cn("h-5 w-5 transition-colors duration-300", isHovered ? "text-[#0F172A]" : "text-gray-400")} />
            </div>
            
            <div className="mt-2 text-center bg-white/80 backdrop-blur-sm px-2 py-1 rounded-lg">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#0F172A]">{node.label}</p>
              <div className={cn(
                "flex items-center justify-center gap-1 text-[10px] font-semibold mt-0.5",
                isUp ? "text-[#10B981]" : "text-[#EF4444]"
              )}>
                {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                {node.value}
              </div>
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex gap-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider z-10">
        <div className="flex items-center gap-1.5 bg-white/90 px-2 py-1.5 rounded-lg shadow-sm backdrop-blur-sm">
          <span className="h-2 w-2 rounded-full bg-[#10B981] shadow-[0_0_8px_#10B981]" /> Capital Inflow
        </div>
        <div className="flex items-center gap-1.5 bg-white/90 px-2 py-1.5 rounded-lg shadow-sm backdrop-blur-sm">
          <span className="h-2 w-2 rounded-full bg-[#EF4444] shadow-[0_0_8px_#EF4444]" /> Capital Outflow
        </div>
      </div>
    </div>
  );
}

export function MarketPulse() {
  const movers = [
    { symbol: 'AAPL', name: 'Apple Inc.', price: '$185.92', change: '+1.24%', trend: 'up', label: 'AI Leader', sentiment: 'positive' },
    { symbol: 'NVDA', name: 'Nvidia Corp.', price: '$485.20', change: '+3.41%', trend: 'up', label: 'High Conviction', sentiment: 'positive' },
    { symbol: 'ARM', name: 'Arm Holdings', price: '$65.40', change: '-0.85%', trend: 'down', label: 'Overvalued', sentiment: 'negative' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {movers.map((mover) => (
        <div key={mover.symbol} className="flex flex-col rounded-[20px] border border-gray-100 bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition-all duration-300">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F3F4F6] text-[#0F172A] font-bold text-sm">
                {mover.symbol[0]}
              </div>
              <div>
                <h4 className="font-bold text-[#0F172A] leading-tight">{mover.symbol}</h4>
                <p className="text-xs font-medium text-gray-500">{mover.name}</p>
              </div>
            </div>
            {mover.label && (
              <span className={cn(
                "px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider",
                mover.sentiment === 'positive' ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
              )}>
                {mover.label}
              </span>
            )}
          </div>
          <div className="mt-5 flex items-end justify-between">
            <span className="text-2xl font-bold tracking-tight text-[#0F172A]">{mover.price}</span>
            <div className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
              mover.trend === 'up' 
                ? "bg-emerald-50 text-emerald-700" 
                : "bg-red-50 text-red-700"
            )}>
              {mover.trend === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {mover.change}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MarketOverview() {
  return (
    <div className="flex flex-col gap-4 bg-white rounded-[24px] p-6 sm:p-8 shadow-[0_8px_30px_rgba(0,0,0,0.02)] border border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-xl font-bold text-[#0F172A] flex items-center gap-2">
            Market Intelligence Map
          </h2>
          <p className="text-sm font-medium text-gray-500 mt-1">Cross-market capital flow and institutional influence.</p>
        </div>
      </div>

      <MarketMap />
      
      <div className="flex items-center justify-between mt-4 mb-2">
        <h3 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider">Market Pulse</h3>
        <button className="text-[11px] font-bold uppercase tracking-widest text-[#F59E0B] hover:text-amber-600 transition-colors">
          View All Equities &rarr;
        </button>
      </div>
      
      <MarketPulse />
    </div>
  );
}
