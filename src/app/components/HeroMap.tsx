import React, { useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface HeroMapProps {
  onHubClick?: (city: string) => void;
}

export function HeroMap({ onHubClick }: HeroMapProps) {
  const hubs = [
    { name: 'New York',      coordinates: [-74.006,   40.7128]  },
    { name: 'São Paulo',     coordinates: [-46.6333, -23.5505]  },
    { name: 'London',        coordinates: [-0.1276,   51.5074]  },
    { name: 'Johannesburg',  coordinates: [28.0473,  -26.2041]  },
    { name: 'Tel Aviv',      coordinates: [34.7818,   32.0853]  },
    { name: 'Tokyo',         coordinates: [139.6917,  35.6895]  },
    { name: 'Sydney',        coordinates: [151.2093, -33.8688]  },
  ];

  const [hoveredHub, setHoveredHub] = useState<string | null>(null);

  return (
    <div className="relative w-full h-[400px] sm:h-[500px] lg:h-[600px] flex items-center justify-center overflow-visible pointer-events-auto">
      <style>
        {`
          @keyframes map-pulse-fade {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          .map-dot-pulse {
            animation: map-pulse-fade 2s ease-in-out infinite;
          }
        `}
      </style>
      <ComposableMap
        projectionConfig={{ scale: 160, center: [10, 25] }}
        width={800}
        height={500}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="#9CA3AF"
                stroke="#F3F4F6"
                strokeWidth={0.5}
                style={{
                  default: { outline: "none" },
                  hover:   { outline: "none", fill: "#6B7280" },
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
            onClick={() => onHubClick?.(hub.name)}
          >
            <g className={cn("cursor-pointer", onHubClick && "hover:opacity-80 transition-opacity")}>
              <circle r={16} fill="transparent" />
              <circle
                r={hoveredHub === hub.name ? 7 : 5}
                fill={hoveredHub === hub.name ? "#F59E0B" : "#F59E0B"}
                stroke="#F3F4F6"
                strokeWidth={1.5}
                className="map-dot-pulse pointer-events-none"
                style={{ transformOrigin: "center", transition: "r 0.15s ease" }}
              />
              {onHubClick && hoveredHub === hub.name && (
                <circle r={14} fill="#F59E0B" fillOpacity={0.15} className="pointer-events-none" />
              )}
              <text
                textAnchor="middle"
                y={-14}
                className={cn(
                  "text-[11px] font-bold fill-[#111827] uppercase tracking-widest transition-opacity duration-300 pointer-events-none",
                  hoveredHub === hub.name ? "opacity-100" : "opacity-0"
                )}
                style={{ filter: "drop-shadow(0px 1px 2px rgba(255,255,255,0.8))" }}
              >
                {hub.name}
              </text>
              {onHubClick && hoveredHub === hub.name && (
                <text
                  textAnchor="middle"
                  y={24}
                  className="text-[9px] font-bold fill-[#F59E0B] uppercase tracking-widest pointer-events-none opacity-80"
                >
                  View startups →
                </text>
              )}
            </g>
          </Marker>
        ))}
      </ComposableMap>
    </div>
  );
}
