import React, { useState, useEffect, useMemo } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import { fetchStartups, fetchInvestors, type Startup, type InvestorRow } from '../../lib/supabase';

// ── Projection constants (geoEquirectangular, scale=140, center=[10,20]) ──────
const MAP_W = 800;
const MAP_H = 450;
const MAP_SCALE = 140;
const MAP_CENTER: [number, number] = [10, 20];
const K = MAP_SCALE * Math.PI / 180; // px per degree

function project(lng: number, lat: number): [number, number] {
  return [
    (lng - MAP_CENTER[0]) * K + MAP_W / 2,
    -(lat - MAP_CENTER[1]) * K + MAP_H / 2,
  ];
}

function bezierPath([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const cy = my - dist * 0.38;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

// ── Hub registry ───────────────────────────────────────────────────────────────

interface HubDef { id: string; name: string; lat: number; lng: number; region: string }

const HUBS: HubDef[] = [
  { id: 'silicon-valley', name: 'Silicon Valley', lat: 37.4,  lng: -122.0, region: 'North America' },
  { id: 'new-york',       name: 'New York',        lat: 40.7,  lng: -74.0,  region: 'North America' },
  { id: 'boston',         name: 'Boston',          lat: 42.4,  lng: -71.1,  region: 'North America' },
  { id: 'austin',         name: 'Austin',          lat: 30.3,  lng: -97.7,  region: 'North America' },
  { id: 'seattle',        name: 'Seattle',         lat: 47.6,  lng: -122.3, region: 'North America' },
  { id: 'toronto',        name: 'Toronto',         lat: 43.7,  lng: -79.4,  region: 'North America' },
  { id: 'sao-paulo',      name: 'São Paulo',       lat: -23.5, lng: -46.6,  region: 'Latin America' },
  { id: 'london',         name: 'London',          lat: 51.5,  lng: -0.1,   region: 'Europe'        },
  { id: 'paris',          name: 'Paris',           lat: 48.9,  lng: 2.4,    region: 'Europe'        },
  { id: 'berlin',         name: 'Berlin',          lat: 52.5,  lng: 13.4,   region: 'Europe'        },
  { id: 'amsterdam',      name: 'Amsterdam',       lat: 52.4,  lng: 4.9,    region: 'Europe'        },
  { id: 'stockholm',      name: 'Stockholm',       lat: 59.3,  lng: 18.1,   region: 'Europe'        },
  { id: 'tel-aviv',       name: 'Tel Aviv',        lat: 32.1,  lng: 34.8,   region: 'Middle East'   },
  { id: 'dubai',          name: 'Dubai',           lat: 25.2,  lng: 55.3,   region: 'Middle East'   },
  { id: 'bangalore',      name: 'Bangalore',       lat: 13.0,  lng: 77.6,   region: 'Asia'          },
  { id: 'singapore',      name: 'Singapore',       lat: 1.4,   lng: 103.8,  region: 'Asia'          },
  { id: 'beijing',        name: 'Beijing',         lat: 39.9,  lng: 116.4,  region: 'Asia'          },
  { id: 'shanghai',       name: 'Shanghai',        lat: 31.2,  lng: 121.5,  region: 'Asia'          },
  { id: 'tokyo',          name: 'Tokyo',           lat: 35.7,  lng: 139.7,  region: 'Asia'          },
  { id: 'sydney',         name: 'Sydney',          lat: -33.9, lng: 151.2,  region: 'Oceania'       },
];

const HUB_BY_ID: Record<string, HubDef> = Object.fromEntries(HUBS.map(h => [h.id, h]));

// ── City / country → hub resolution ───────────────────────────────────────────

const CITY_HUB: Record<string, string> = {
  'san francisco': 'silicon-valley', 'san jose': 'silicon-valley',
  'palo alto': 'silicon-valley',     'menlo park': 'silicon-valley',
  'mountain view': 'silicon-valley', 'sunnyvale': 'silicon-valley',
  'santa clara': 'silicon-valley',   'redwood city': 'silicon-valley',
  'silicon valley': 'silicon-valley',
  'new york': 'new-york',            'new york city': 'new-york', 'nyc': 'new-york',
  'boston': 'boston',                'cambridge': 'boston',
  'austin': 'austin',
  'seattle': 'seattle',              'bellevue': 'seattle',
  'toronto': 'toronto',              'waterloo': 'toronto',
  'são paulo': 'sao-paulo',          'sao paulo': 'sao-paulo',
  'london': 'london',
  'paris': 'paris',
  'berlin': 'berlin',                'munich': 'berlin',
  'amsterdam': 'amsterdam',
  'stockholm': 'stockholm',
  'tel aviv': 'tel-aviv',            'herzliya': 'tel-aviv',
  'dubai': 'dubai',                  'abu dhabi': 'dubai',
  'bangalore': 'bangalore',          'bengaluru': 'bangalore', 'hyderabad': 'bangalore',
  'singapore': 'singapore',
  'beijing': 'beijing',              'shenzhen': 'beijing',
  'shanghai': 'shanghai',
  'tokyo': 'tokyo',                  'osaka': 'tokyo',
  'sydney': 'sydney',                'melbourne': 'sydney',
};

const COUNTRY_HUB: Record<string, string> = {
  'united states': 'silicon-valley', 'usa': 'silicon-valley', 'us': 'silicon-valley',
  'united kingdom': 'london',        'uk': 'london', 'gb': 'london',
  'israel': 'tel-aviv',
  'germany': 'berlin',
  'singapore': 'singapore',
  'china': 'beijing',
  'japan': 'tokyo',
  'france': 'paris',
  'netherlands': 'amsterdam',
  'sweden': 'stockholm',
  'canada': 'toronto',
  'australia': 'sydney',
  'india': 'bangalore',
  'united arab emirates': 'dubai',   'uae': 'dubai',
  'brazil': 'sao-paulo',
};

function resolveHub(city: string | null, country: string | null): string | null {
  if (city) { const h = CITY_HUB[city.toLowerCase().trim()]; if (h) return h; }
  if (country) { const h = COUNTRY_HUB[country.toLowerCase().trim()]; if (h) return h; }
  return null;
}

// ── Sector ─────────────────────────────────────────────────────────────────────

type SectorKey = 'all' | 'cybersecurity' | 'fintech' | 'ai-ml' | 'dev-tools';

const SECTOR_LABELS: Record<SectorKey, string> = {
  all: 'All Sectors', cybersecurity: 'Cybersecurity',
  fintech: 'FinTech', 'ai-ml': 'AI / ML', 'dev-tools': 'Dev Tools',
};

const SECTOR_KW: Record<string, string[]> = {
  cybersecurity: ['cyber', 'security', 'threat', 'zero trust', 'endpoint', 'iam', 'soc'],
  fintech:       ['fintech', 'payment', 'banking', 'neobank', 'insurtech', 'crypto', 'blockchain', 'lending'],
  'ai-ml':       ['artificial intelligence', 'machine learning', ' ai ', 'llm', 'generative', 'nlp', 'deep learning'],
  'dev-tools':   ['developer tool', 'devops', 'saas', 'platform', 'infrastructure', 'api ', 'cloud', 'kubernetes'],
};

function matchesSector(s: Startup, sector: SectorKey): boolean {
  if (sector === 'all') return true;
  const kw = SECTOR_KW[sector] ?? [];
  const text = `${s.description ?? ''} ${s.industry ?? ''}`.toLowerCase();
  return kw.some(k => text.includes(k));
}

// ── Growth scoring ─────────────────────────────────────────────────────────────

const G_SCORE: Record<string, number> = {
  'rapid growth': 100, 'moderate growth': 70, 'stable': 40, 'reduction': 10, 'unknown': 30,
};

// ── Data derivation ────────────────────────────────────────────────────────────

interface ArcData { fromId: string; toId: string; count: number; totalAmount: number }

interface HubStats {
  companies: number; capital: number; unicorns: number;
  avgAlpha: number; velocity: number; talent: number;
}

interface Insights {
  capitalConcentration: number; marketRating: number; talentSignal: number;
  localCapitalPct: number; hubMomentum: number; crossBorderIndex: number;
}

function buildInvHub(investors: InvestorRow[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const inv of investors) {
    if (!inv.headquarters) continue;
    const city = inv.headquarters.split(',')[0]?.trim().toLowerCase();
    const h = city ? CITY_HUB[city] : undefined;
    if (h) m[inv.name.toLowerCase()] = h;
  }
  return m;
}

function computeArcs(startups: Startup[], investors: InvestorRow[]): ArcData[] {
  const invHub = buildInvHub(investors);
  const map = new Map<string, { count: number; total: number }>();

  for (const s of startups) {
    const toHub = resolveHub(s.city, s.country);
    if (!toHub) continue;
    for (const fr of s.funding_rounds) {
      const li = fr.lead_investor?.toLowerCase();
      if (!li) continue;
      const fromHub = invHub[li];
      if (!fromHub || fromHub === toHub) continue;
      const key = `${fromHub}→${toHub}`;
      const ex = map.get(key) ?? { count: 0, total: 0 };
      ex.count++;
      ex.total += fr.amount_raised ?? 0;
      map.set(key, ex);
    }
  }

  return Array.from(map.entries())
    .map(([key, d]) => { const [fromId, toId] = key.split('→'); return { fromId, toId, count: d.count, totalAmount: d.total }; })
    .sort((a, b) => b.count - a.count)
    .slice(0, 60);
}

function computeHubStats(startups: Startup[], hubId: string, sector: SectorKey): HubStats {
  const hs = startups.filter(s => resolveHub(s.city, s.country) === hubId && matchesSector(s, sector));
  let capital = 0, alphaSum = 0, talent = 0, unicorns = 0;

  for (const s of hs) {
    for (const fr of s.funding_rounds) { if (fr.amount_raised) capital += fr.amount_raised; }
    const latestVal = s.funding_rounds
      .filter(fr => fr.valuation != null)
      .sort((a, b) => (b.announcement_date ?? '').localeCompare(a.announcement_date ?? ''))[0]?.valuation;
    if (latestVal && latestVal >= 1e9) unicorns++;
    alphaSum += G_SCORE[s.growth_trend ?? 'unknown'] ?? 30;
    talent += s.employee_count ?? 0;
  }

  const count = hs.length;
  const avgAlpha = count ? Math.round(alphaSum / count) : 0;
  const velocity = count
    ? Math.round(hs.filter(s => s.growth_trend === 'rapid growth' || s.growth_trend === 'moderate growth').length / count * 100)
    : 0;

  return { companies: count, capital: capital / 1e6, unicorns, avgAlpha, velocity, talent };
}

function computeInsights(
  startups: Startup[], investors: InvestorRow[],
  hubId: string, sector: SectorKey
): Insights {
  const hs = startups.filter(s => resolveHub(s.city, s.country) === hubId && matchesSector(s, sector));
  const count = hs.length;
  const invHub = buildInvHub(investors);

  const talentSignal = count
    ? Math.round(hs.filter(s => s.growth_trend === 'rapid growth').length / count * 100) : 0;

  const invInHub = investors.filter(inv => {
    const city = inv.headquarters?.split(',')[0]?.trim().toLowerCase();
    return city ? CITY_HUB[city] === hubId : false;
  });
  const marketRating = count ? Math.min(100, Math.round(invInHub.length / count * 200)) : 0;

  const invCapital: Record<string, number> = {};
  let totalRaised = 0, localLeads = 0, foreignLeads = 0;

  for (const s of hs) {
    for (const fr of s.funding_rounds) {
      const li = fr.lead_investor?.toLowerCase();
      const amt = fr.amount_raised ?? 0;
      totalRaised += amt;
      if (li) {
        invCapital[li] = (invCapital[li] ?? 0) + amt;
        const liHub = invHub[li];
        if (liHub === hubId) localLeads++; else foreignLeads++;
      }
    }
  }

  const maxCap = Math.max(0, ...Object.values(invCapital));
  const capitalConcentration = totalRaised > 0 ? Math.round(maxCap / totalRaised * 100) : 0;
  const totalLeads = localLeads + foreignLeads;
  const localCapitalPct = totalLeads > 0 ? Math.round(localLeads / totalLeads * 100) : 50;
  const crossBorderIndex = totalLeads > 0 ? Math.round(foreignLeads / totalLeads * 100) : 50;
  const alphaSum = hs.reduce((s, st) => s + (G_SCORE[st.growth_trend ?? 'unknown'] ?? 30), 0);
  const hubMomentum = count ? Math.round(alphaSum / count) : 0;

  return { capitalConcentration, marketRating, talentSignal, localCapitalPct, hubMomentum, crossBorderIndex };
}

function getTickerItems(startups: Startup[]): string[] {
  const rounds: { date: string; text: string }[] = [];
  for (const s of startups) {
    for (const fr of s.funding_rounds) {
      if (!fr.announcement_date) continue;
      const amt = fr.amount_raised
        ? fr.amount_raised >= 1e9
          ? `$${(fr.amount_raised / 1e9).toFixed(1)}B`
          : `$${(fr.amount_raised / 1e6).toFixed(0)}M`
        : 'undisclosed';
      const inv = fr.lead_investor ?? fr.investors?.[0] ?? null;
      rounds.push({ date: fr.announcement_date, text: inv ? `${s.name} raised ${amt} from ${inv}` : `${s.name} raised ${amt}` });
    }
  }
  return rounds.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map(r => r.text);
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function fmtCapital(m: number): string {
  if (m >= 1000) return `$${(m / 1000).toFixed(1)}B`;
  if (m >= 1) return `$${m.toFixed(0)}M`;
  return '<$1M';
}

function fmtTalent(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

export function GlobalTechHubMap() {
  const [startups, setStartups]     = useState<Startup[]>([]);
  const [investors, setInvestors]   = useState<InvestorRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selectedHub, setSelectedHub] = useState<string | null>(null);
  const [hoveredHub, setHoveredHub] = useState<string | null>(null);
  const [sector, setSector]         = useState<SectorKey>('all');

  useEffect(() => {
    Promise.all([fetchStartups(), fetchInvestors()])
      .then(([s, i]) => { setStartups(s); setInvestors(i); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const arcs = useMemo(() => computeArcs(startups, investors), [startups, investors]);

  const visibleArcs = useMemo(() =>
    arcs.filter(a => !selectedHub || a.fromId === selectedHub || a.toId === selectedHub),
    [arcs, selectedHub]
  );

  const hubCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of startups) { const h = resolveHub(s.city, s.country); if (h) c[h] = (c[h] ?? 0) + 1; }
    return c;
  }, [startups]);

  const hubStats  = useMemo<HubStats  | null>(() => selectedHub ? computeHubStats(startups, selectedHub, sector) : null, [startups, selectedHub, sector]);
  const insights  = useMemo<Insights  | null>(() => selectedHub ? computeInsights(startups, investors, selectedHub, sector) : null, [startups, investors, selectedHub, sector]);
  const ticker    = useMemo(() => getTickerItems(startups), [startups]);

  const activeHub = selectedHub ? HUB_BY_ID[selectedHub] : null;

  function dotR(hubId: string) { return Math.max(4, Math.min(10, 4 + (hubCounts[hubId] ?? 0) * 0.05)); }

  return (
    <div style={{ background: '#060e1a', borderRadius: 24, overflow: 'hidden' }}>

      {/* ── CSS ─────────────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes hub-pulse { 0%,100%{opacity:.55} 50%{opacity:.05} }
        .hub-pulse-ring { animation: hub-pulse 2.8s ease-in-out infinite; }
        @keyframes ticker-scroll { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        .ticker-track { animation: ticker-scroll 70s linear infinite; }
        @keyframes arc-dash { to { stroke-dashoffset: -200; } }
        .arc-flow { stroke-dasharray: 6 10; animation: arc-dash 3s linear infinite; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 py-5"
        style={{ borderBottom: '1px solid #1a2a3f' }}
      >
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Global Capital Flow</h2>
          <p className="text-sm text-slate-400 mt-0.5">Cross-border investment activity across tech ecosystems</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SECTOR_LABELS) as SectorKey[]).map(k => (
            <button
              key={k}
              onClick={() => setSector(k)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200"
              style={sector === k
                ? { background: '#F59E0B', color: '#fff', border: '1px solid #F59E0B' }
                : { background: '#0d1f35', color: '#94a3b8', border: '1px solid #1a2a3f' }}
            >
              {SECTOR_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Map + Panel ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row">

        {/* Map */}
        <div className="flex-1 relative" style={{ height: 450 }}>
          <ComposableMap
            projection="geoEquirectangular"
            projectionConfig={{ scale: MAP_SCALE, center: MAP_CENTER }}
            width={MAP_W}
            height={MAP_H}
            style={{ width: '100%', height: '100%' }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map(geo => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#0d1e35"
                    stroke="#1a2a3f"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: 'none' },
                      hover:   { outline: 'none', fill: '#0d2347' },
                      pressed: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>

            {/* Hub markers */}
            {HUBS.map(hub => {
              const isSelected = selectedHub === hub.id;
              const isHovered  = hoveredHub  === hub.id;
              const r = dotR(hub.id);

              return (
                <Marker
                  key={hub.id}
                  coordinates={[hub.lng, hub.lat]}
                  onMouseEnter={() => setHoveredHub(hub.id)}
                  onMouseLeave={() => setHoveredHub(null)}
                  onClick={() => setSelectedHub(prev => prev === hub.id ? null : hub.id)}
                >
                  <g className="cursor-pointer">
                    <circle r={18} fill="transparent" />
                    {isSelected && (
                      <circle r={r + 7} fill="rgba(245,158,11,0.12)" stroke="rgba(245,158,11,0.35)" strokeWidth={1.5} />
                    )}
                    <circle
                      className={!isSelected ? 'hub-pulse-ring' : ''}
                      r={r + 5}
                      fill="none"
                      stroke="rgba(245,158,11,0.4)"
                      strokeWidth={1}
                    />
                    <circle
                      r={isSelected || isHovered ? r + 2 : r}
                      fill="#F59E0B"
                      fillOpacity={isSelected ? 1 : isHovered ? 0.9 : 0.65}
                      stroke={isSelected ? '#FCD34D' : '#060e1a'}
                      strokeWidth={isSelected ? 2 : 1.5}
                      style={{ transition: 'r 0.2s ease, fill-opacity 0.2s ease' }}
                    />
                    {(isSelected || isHovered) && (
                      <text
                        textAnchor="middle"
                        y={-(r + 12)}
                        fontSize={8}
                        fontWeight={700}
                        fill="white"
                        letterSpacing="0.1em"
                        className="pointer-events-none uppercase"
                        style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))' }}
                      >
                        {hub.name}
                      </text>
                    )}
                  </g>
                </Marker>
              );
            })}
          </ComposableMap>

          {/* Arc overlay — uses same equirectangular math, coordinates align exactly */}
          <svg
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            <defs>
              <filter id="glow-arc" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {visibleArcs.map(arc => {
              const from = HUB_BY_ID[arc.fromId];
              const to   = HUB_BY_ID[arc.toId];
              if (!from || !to) return null;
              const p1 = project(from.lng, from.lat);
              const p2 = project(to.lng, to.lat);
              const d  = bezierPath(p1, p2);
              const op = Math.min(0.7, 0.2 + arc.count * 0.08);
              const sw = Math.min(2.0, 0.5 + arc.count * 0.2);
              return (
                <path
                  key={`${arc.fromId}-${arc.toId}`}
                  d={d}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth={sw}
                  opacity={op}
                  filter="url(#glow-arc)"
                  className="arc-flow"
                />
              );
            })}
          </svg>

          {/* Legend */}
          <div className="absolute bottom-3 left-4 flex items-center gap-4 pointer-events-none">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#F59E0B', opacity: 0.7 }} />
              <span className="text-[10px] text-slate-500">Tech Hub</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-px" style={{ background: 'rgba(245,158,11,0.6)' }} />
              <span className="text-[10px] text-slate-500">Capital Flow</span>
            </div>
            <span className="text-[10px] text-slate-600">Click a hub to explore</span>
          </div>

          {loading && (
            <div className="absolute top-4 right-4 flex items-center gap-2 text-xs text-amber-400 pointer-events-none">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Loading data…
            </div>
          )}
        </div>

        {/* ── Side Panel ───────────────────────────────────────────────────── */}
        <div
          className="w-full lg:w-[340px] shrink-0 flex flex-col"
          style={{ borderLeft: '1px solid #1a2a3f', minHeight: 450 }}
        >
          {activeHub && hubStats && insights ? (
            <>
              {/* Hub header */}
              <div className="flex items-start justify-between px-6 py-5" style={{ borderBottom: '1px solid #1a2a3f' }}>
                <div>
                  <h3 className="text-lg font-bold text-white">{activeHub.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{activeHub.region}</p>
                </div>
                <button
                  onClick={() => setSelectedHub(null)}
                  className="text-slate-500 hover:text-slate-300 transition-colors mt-0.5 text-xl leading-none"
                >
                  ×
                </button>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-px" style={{ background: '#1a2a3f', borderBottom: '1px solid #1a2a3f' }}>
                {[
                  { label: 'Companies',    value: hubStats.companies.toLocaleString() },
                  { label: 'Unicorns',     value: String(hubStats.unicorns) },
                  { label: 'Total Capital',value: fmtCapital(hubStats.capital) },
                  { label: 'Avg Alpha',    value: String(hubStats.avgAlpha) },
                  { label: 'Velocity',     value: `${hubStats.velocity}%` },
                  { label: 'Talent Pool',  value: fmtTalent(hubStats.talent) },
                ].map(stat => (
                  <div key={stat.label} className="flex flex-col px-5 py-4" style={{ background: '#060e1a' }}>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">{stat.label}</span>
                    <span className="text-xl font-bold text-white">{stat.value}</span>
                  </div>
                ))}
              </div>

              {/* Alpha Insights */}
              <div className="px-6 py-5" style={{ borderBottom: '1px solid #1a2a3f' }}>
                <h4 className="text-[9px] font-bold uppercase tracking-widest text-amber-400 mb-4">Alpha Insights</h4>
                {[
                  { label: 'Capital Concentration', value: insights.capitalConcentration, desc: 'Top investor share of total deployed' },
                  { label: 'Market Rating',          value: insights.marketRating,          desc: 'Investor-to-startup density score'   },
                  { label: 'Talent Signal',          value: insights.talentSignal,          desc: '% startups with rapid growth'        },
                ].map(item => (
                  <div key={item.label} className="mb-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-slate-400">{item.label}</span>
                      <span className="text-sm font-bold text-white">{item.value}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a2a3f' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(100, item.value)}%`, background: 'linear-gradient(90deg,#F59E0B,#FCD34D)', transition: 'width .6s ease' }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1">{item.desc}</p>
                  </div>
                ))}
              </div>

              {/* Ecosystem Health */}
              <div className="px-6 py-5">
                <h4 className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 mb-3">Ecosystem Health</h4>
                {[
                  { label: 'Local Capital',       value: insights.localCapitalPct,  suffix: '%', color: '#10b981' },
                  { label: 'Hub Momentum',         value: insights.hubMomentum,       suffix: '',  color: '#10b981' },
                  { label: 'Cross-Border Index',   value: insights.crossBorderIndex,  suffix: '%', color: '#10b981' },
                ].map((item, i, arr) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between py-3"
                    style={{ borderBottom: i < arr.length - 1 ? '1px solid #0d1e35' : 'none' }}
                  >
                    <span className="text-xs text-slate-400">{item.label}</span>
                    <span className="text-sm font-bold" style={{ color: item.color }}>{item.value}{item.suffix}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth={1.5} className="w-6 h-6">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-300 mb-2">Select a Hub</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Click any pulsing dot on the map to explore hub analytics, capital flows, and ecosystem health metrics.
              </p>
              {loading && (
                <div className="flex items-center gap-2 mt-5 text-xs text-amber-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Fetching ecosystem data…
                </div>
              )}
              {!loading && startups.length > 0 && (
                <div className="mt-5 grid grid-cols-2 gap-3 w-full max-w-[220px]">
                  <div className="rounded-xl p-3 text-center" style={{ background: '#0d1f35', border: '1px solid #1a2a3f' }}>
                    <div className="text-base font-bold text-white">{startups.length}</div>
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider">Startups</div>
                  </div>
                  <div className="rounded-xl p-3 text-center" style={{ background: '#0d1f35', border: '1px solid #1a2a3f' }}>
                    <div className="text-base font-bold text-white">{investors.length}</div>
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider">Investors</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Ticker ──────────────────────────────────────────────────────────── */}
      {ticker.length > 0 && (
        <div className="flex items-center overflow-hidden" style={{ borderTop: '1px solid #1a2a3f', background: '#030d19' }}>
          <div
            className="shrink-0 px-4 py-2.5 text-[9px] font-bold uppercase tracking-widest text-amber-400"
            style={{ borderRight: '1px solid #1a2a3f' }}
          >
            Live
          </div>
          <div className="overflow-hidden flex-1">
            <div className="ticker-track flex gap-16 py-2.5 whitespace-nowrap">
              {[...ticker, ...ticker].map((item, i) => (
                <span key={i} className="text-[11px] text-slate-400 shrink-0">
                  <span className="text-amber-400 mr-1.5">●</span>{item}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
