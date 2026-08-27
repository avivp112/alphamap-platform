import React, { useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SectorWeight { sector: string; weight: number }

interface Props {
  data:        SectorWeight[];
  accentColor: string;    // firm accent — fallback for unknown sector keys
  height?:     number;
}

// ── Sector colour palette ─────────────────────────────────────────────────────
// Fixed per-sector colours so the same sector reads the same colour on every
// card regardless of which firm is displayed — makes cross-card comparison
// intuitive. Chosen for legibility on dark navy backgrounds.

const SECTOR_COLOR: Record<string, string> = {
  AI:         "#06b6d4",   // cyan-500
  FinTech:    "#7c3aed",   // violet-600
  Cyber:      "#10b981",   // emerald-500
  SaaS:       "#3b82f6",   // blue-500
  HealthTech: "#ec4899",   // pink-500
  FoodTech:   "#f59e0b",   // amber-500
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sectorColor(sector: string, fallback: string): string {
  return SECTOR_COLOR[sector] ?? fallback;
}

/** Returns the entry with the highest weight, or null for an empty array. */
function topSector(entries: SectorWeight[]): SectorWeight | null {
  if (!entries.length) return null;
  return entries.reduce((max, d) => (d.weight > max.weight ? d : max), entries[0]);
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
// Anchored to a fixed corner of the chart box (rather than following the
// cursor, which is how Recharts' built-in Tooltip works by default) so it
// never lands on top of the ring or the center "Top Focus" label — the donut
// is too small for a cursor-following tooltip to have anywhere to go.

type PieDatum = { sector: string; pct: number; color: string };

function DarkTooltip({ d }: { d: PieDatum }) {
  return (
    <div
      className="absolute z-20 pointer-events-none"
      style={{
        top: 6,
        right: 6,
        maxWidth: 130,
        background:   "#06101e",
        border:       `1px solid ${d.color}50`,
        borderRadius: 10,
        padding:      "7px 12px",
        boxShadow:    `0 10px 28px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04)`,
        fontSize:     12,
      }}
    >
      <div style={{ color: d.color, fontWeight: 700, marginBottom: 2 }}>{d.sector}</div>
      <div style={{ color: "#94a3b8" }}>{d.pct}% allocation</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DonutFocusChart({ data, accentColor, height = 190 }: Props) {
  const [hovered, setHovered] = useState<PieDatum | null>(null);
  const total = data.reduce((s, d) => s + (d.weight ?? 0), 0);

  // Normalise weights → whole-number percentages; suppress micro-slivers < 4%
  // so the chart never looks cluttered when a firm has 5-6 narrow slivers.
  const pieData: PieDatum[] = data
    .map(d => ({
      sector: d.sector,
      weight: d.weight,
      pct:    total > 0 ? Math.round((d.weight / total) * 100) : 0,
      color:  sectorColor(d.sector, accentColor),
    }))
    .filter(d => d.pct >= 4)
    .sort((a, b) => b.weight - a.weight);

  const top        = topSector(pieData.map(d => ({ sector: d.sector, weight: d.weight })));
  const topColor   = top ? sectorColor(top.sector, accentColor) : accentColor;
  const topPct     = top && total > 0 ? Math.round((top.weight / total) * 100) : null;

  // Edge-case: all sectors are below the 4% threshold → show full ring in accent
  if (pieData.length === 0) {
    return (
      <div className="flex items-center justify-center text-slate-700 text-[11px] font-medium" style={{ height }}>
        No sector data
      </div>
    );
  }

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <Pie
            data={pieData}
            dataKey="weight"
            nameKey="sector"
            innerRadius="54%"
            outerRadius="80%"
            paddingAngle={pieData.length > 1 ? 3 : 0}
            startAngle={90}
            endAngle={-270}
            strokeWidth={0}
            isAnimationActive={true}
            animationBegin={0}
            animationDuration={600}
            animationEasing="ease-out"
          >
            {pieData.map(entry => (
              <Cell
                key={entry.sector}
                fill={entry.color}
                opacity={0.90}
                style={{
                  filter:  `drop-shadow(0 0 5px ${entry.color}60)`,
                  outline: "none",
                  cursor:  "default",
                }}
                onMouseEnter={() => setHovered(entry)}
                onMouseLeave={() => setHovered(null)}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {hovered && <DarkTooltip d={hovered} />}

      {/* ── Center metric ──────────────────────────────────────────────────── */}
      {/* Occupies the empty real-estate inside the donut ring to surface the   */}
      {/* dominant sector at a glance — no wasted space.                        */}
      {top && topPct !== null && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"
          style={{ gap: 1 }}
        >
          <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-600 leading-none">
            Top Focus
          </span>
          <span
            className="text-[11px] font-black text-white leading-snug text-center"
            style={{ maxWidth: 72, lineHeight: "1.2" }}
          >
            {top.sector}
          </span>
          <span
            className="text-[16px] font-black leading-none tabular-nums"
            style={{ color: topColor, textShadow: `0 0 14px ${topColor}70` }}
          >
            {topPct}%
          </span>
        </div>
      )}
    </div>
  );
}
