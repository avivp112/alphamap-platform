import React, { useState } from 'react';
import { TrendingUp, TrendingDown, MapPin, Search } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

export function MarketMap() {
  const hubs = [
    { name: 'New York', coordinates: [-74.006, 40.7128], data: '+0.5% Mkt', status: 'up' as const },
    { name: 'London', coordinates: [-0.1276, 51.5074], data: '-0.2% Mkt', status: 'down' as const },
    { name: 'Tel Aviv', coordinates: [34.7818, 32.0853], data: '+1.1% Tech', status: 'up' as const },
    { name: 'Tokyo', coordinates: [139.6917, 35.6895], data: '+0.8% Nikkei', status: 'up' as const },
  ];

  const [hoveredHub, setHoveredHub] = useState<string | null>(null);

  return (
    <div className="relative h-80 w-full overflow-hidden rounded-xl border border-gray-100 bg-[#F3F4F6] mb-6 flex items-center justify-center">
      {/* Interactive Hubs */}
      <ComposableMap
        projectionConfig={{
          scale: 140,
          center: [0, 20]
        }}
        width={800}
        height={400}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography 
                key={geo.rsmKey} 
                geography={geo} 
                fill="#E5E7EB" 
                stroke="#D1D5DB" 
                strokeWidth={0.5}
                style={{
                  default: { outline: "none" },
                  hover: { outline: "none", fill: "#D1D5DB" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {hubs.map((hub) => (
          <Marker 
            key={hub.name} 
            coordinates={hub.coordinates as [number, number]}
            onMouseEnter={() => setHoveredHub(hub.name)}
            onMouseLeave={() => setHoveredHub(null)}
          >
            <g className="cursor-pointer group">
              <circle 
                r={6} 
                fill={hub.status === 'up' ? "#10B981" : "#EF4444"}
                stroke="#F3F4F6"
                strokeWidth={2}
                className={cn(
                  "transition-all duration-300 ease-in-out origin-center",
                  hoveredHub === hub.name ? "scale-150" : "scale-100 group-hover:scale-125"
                )}
                style={{ transformOrigin: "center" }}
              />
              
              {/* Always visible minimal label for Bloomberg feel */}
              <text
                textAnchor="middle"
                y={15}
                className={cn(
                  "text-[10px] font-bold fill-gray-500 uppercase tracking-widest transition-opacity duration-300 pointer-events-none",
                  hoveredHub === hub.name ? "opacity-0" : "opacity-100"
                )}
              >
                {hub.name.split(' ')[0]}
              </text>
            </g>
          </Marker>
        ))}
      </ComposableMap>

      {/* HTML overlay tooltips */}
      {hubs.map((hub) => {
        // We render simple tooltips that show on hover.
        // We'll just position them near the corners of the component for now, or display a single active tooltip
        if (hoveredHub !== hub.name) return null;
        return (
          <div 
            key={`${hub.name}-tooltip`}
            className="absolute top-4 right-4 flex min-w-max flex-col items-center rounded-lg bg-white px-4 py-2 shadow-md border border-gray-100 z-10 animate-in fade-in zoom-in-95 duration-200"
          >
            <span className="text-sm font-semibold text-[#111827]">{hub.name}</span>
            <span className={cn(
              "text-xs font-medium flex items-center gap-1 mt-0.5",
              hub.status === 'up' ? "text-[#10B981]" : "text-[#EF4444]"
            )}>
              {hub.status === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {hub.data}
            </span>
          </div>
        );
      })}

      {/* Legend */}
      <div className="absolute bottom-3 left-4 flex gap-3 text-[10px] font-medium text-gray-500 uppercase z-10">
        <div className="flex items-center gap-1.5 bg-white/80 px-2 py-1 rounded backdrop-blur-sm">
          <span className="h-2 w-2 rounded-full bg-[#10B981]" /> Positive
        </div>
        <div className="flex items-center gap-1.5 bg-white/80 px-2 py-1 rounded backdrop-blur-sm">
          <span className="h-2 w-2 rounded-full bg-[#EF4444]" /> Negative
        </div>
      </div>
    </div>
  );
}

export function TrendingMovers() {
  const movers = [
    { symbol: 'AAPL', name: 'Apple Inc.', price: '$185.92', change: '+1.24%', trend: 'up' },
    { symbol: 'NVDA', name: 'Nvidia Corp.', price: '$485.20', change: '+3.41%', trend: 'up' },
    { symbol: 'ARM', name: 'Arm Holdings', price: '$65.40', change: '-0.85%', trend: 'down' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {movers.map((mover) => (
        <div key={mover.symbol} className="flex flex-col rounded-xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F3F4F6] text-[#111827] font-bold text-sm">
                {mover.symbol[0]}
              </div>
              <div>
                <h4 className="font-semibold text-[#111827] leading-tight">{mover.symbol}</h4>
                <p className="text-xs text-gray-500 line-clamp-1">{mover.name}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <span className="text-xl font-bold tracking-tight text-[#111827]">{mover.price}</span>
            <div className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
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
    <div className="flex flex-col bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-[#111827] flex items-center gap-2">
            Market Overview
          </h2>
          <p className="text-sm text-gray-500 mt-1">Global hub performance and trending equities.</p>
        </div>
        <button className="text-sm font-medium text-[#F59E0B] hover:text-amber-600 transition-colors">
          View All Markets &rarr;
        </button>
      </div>

      <MarketMap />
      
      <div className="flex items-center justify-between mb-4 mt-2">
        <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wider">Trending Movers</h3>
      </div>
      
      <TrendingMovers />
    </div>
  );
}
