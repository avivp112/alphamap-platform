import React, { useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

export function HeroMap() {
  const hubs = [
    { name: 'New York', coordinates: [-74.006, 40.7128] },       // North America
    { name: 'São Paulo', coordinates: [-46.6333, -23.5505] },    // South America
    { name: 'London', coordinates: [-0.1276, 51.5074] },         // Europe
    { name: 'Johannesburg', coordinates: [28.0473, -26.2041] },  // Africa
    { name: 'Tel Aviv', coordinates: [34.7818, 32.0853] },       // Asia (Middle East)
    { name: 'Tokyo', coordinates: [139.6917, 35.6895] },         // Asia
    { name: 'Sydney', coordinates: [151.2093, -33.8688] },       // Oceania
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
        projectionConfig={{
          scale: 160,
          center: [10, 25]
        }}
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
                fill="#9CA3AF" // Medium-dark gray
                stroke="#F3F4F6" 
                strokeWidth={0.5}
                style={{
                  default: { outline: "none" },
                  hover: { outline: "none", fill: "#6B7280" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {/* Hubs */}
        {hubs.map((hub) => (
          <Marker 
            key={hub.name} 
            coordinates={hub.coordinates as [number, number]}
            onMouseEnter={() => setHoveredHub(hub.name)}
            onMouseLeave={() => setHoveredHub(null)}
          >
            <g className="cursor-pointer">
              {/* Transparent hit area for hover */}
              <circle r={16} fill="transparent" />
              
              {/* Inner dot */}
              <circle 
                r={5} 
                fill="#F59E0B"
                stroke="#F3F4F6"
                strokeWidth={1.5}
                className="map-dot-pulse pointer-events-none"
                style={{ transformOrigin: "center" }}
              />
              
              <text
                textAnchor="middle"
                y={-12}
                className={cn(
                  "text-[11px] font-bold fill-[#111827] uppercase tracking-widest transition-opacity duration-300 pointer-events-none",
                  hoveredHub === hub.name ? "opacity-100" : "opacity-0"
                )}
                style={{ filter: "drop-shadow(0px 1px 2px rgba(255,255,255,0.8))" }}
              >
                {hub.name}
              </text>
            </g>
          </Marker>
        ))}
      </ComposableMap>
    </div>
  );
}
