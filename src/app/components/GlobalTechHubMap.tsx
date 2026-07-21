import React, { useState, useMemo } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import type { Startup, InvestorRow } from '../../lib/supabase';

// ── Projection constants (geoEquirectangular, scale=140, center=[10,15]) ──────
// MAP_H=370 crops the empty polar ocean — inhabited world fills the frame.
const MAP_W = 800;
const MAP_H = 370;
const MAP_SCALE = 140;
const MAP_CENTER: [number, number] = [10, 15];

// ── Hub registry ───────────────────────────────────────────────────────────────

export interface HubDef { id: string; name: string; lat: number; lng: number; region: string }

export const HUBS: HubDef[] = [
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

export const HUB_BY_ID: Record<string, HubDef> = Object.fromEntries(HUBS.map(h => [h.id, h]));

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

export function resolveHub(city: string | null, country: string | null): string | null {
  if (city) { const h = CITY_HUB[city.toLowerCase().trim()]; if (h) return h; }
  if (country) { const h = COUNTRY_HUB[country.toLowerCase().trim()]; if (h) return h; }
  return null;
}

// ── Sector ─────────────────────────────────────────────────────────────────────

export type SectorKey = 'all' | 'cybersecurity' | 'fintech' | 'ai-ml' | 'dev-tools';

export const SECTOR_LABELS: Record<SectorKey, string> = {
  all: 'All Sectors', cybersecurity: 'Cybersecurity',
  fintech: 'FinTech', 'ai-ml': 'AI / ML', 'dev-tools': 'Dev Tools',
};

const SECTOR_KW: Record<string, string[]> = {
  cybersecurity: ['cyber', 'security', 'threat', 'zero trust', 'endpoint', 'iam', 'soc'],
  fintech:       ['fintech', 'payment', 'banking', 'neobank', 'insurtech', 'crypto', 'blockchain', 'lending'],
  'ai-ml':       ['artificial intelligence', 'machine learning', ' ai ', 'llm', 'generative', 'nlp', 'deep learning'],
  'dev-tools':   ['developer tool', 'devops', 'saas', 'platform', 'infrastructure', 'api ', 'cloud', 'kubernetes'],
};

export function matchesSector(s: Startup, sector: SectorKey): boolean {
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

interface HubStats {
  companies: number; capital: number | null; unicorns: number | null;
  avgAlpha: number | null; velocity: number | null; talent: number | null;
}

interface Insights {
  capitalConcentration: number | null; marketRating: number | null; talentSignal: number | null;
  localCapitalPct: number | null; hubMomentum: number | null; crossBorderIndex: number | null;
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
  const avgAlpha = count ? Math.round(alphaSum / count) : null;
  const velocity = count
    ? Math.round(hs.filter(s => s.growth_trend === 'rapid growth' || s.growth_trend === 'moderate growth').length / count * 100)
    : null;

  return {
    companies: count,
    capital: count ? capital / 1e6 : null,
    unicorns: count ? unicorns : null,
    avgAlpha, velocity,
    talent: count ? talent : null,
  };
}

function computeInsights(
  startups: Startup[], investors: InvestorRow[],
  hubId: string, sector: SectorKey
): Insights {
  const hs = startups.filter(s => resolveHub(s.city, s.country) === hubId && matchesSector(s, sector));
  const count = hs.length;
  const invHub = buildInvHub(investors);

  const talentSignal = count
    ? Math.round(hs.filter(s => s.growth_trend === 'rapid growth').length / count * 100) : null;

  const invInHub = investors.filter(inv => {
    const city = inv.headquarters?.split(',')[0]?.trim().toLowerCase();
    return city ? CITY_HUB[city] === hubId : false;
  });
  const marketRating = count ? Math.min(100, Math.round(invInHub.length / count * 200)) : null;

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
  const capitalConcentration = totalRaised > 0 ? Math.round(maxCap / totalRaised * 100) : null;
  const totalLeads = localLeads + foreignLeads;
  const localCapitalPct = totalLeads > 0 ? Math.round(localLeads / totalLeads * 100) : null;
  const crossBorderIndex = totalLeads > 0 ? Math.round(foreignLeads / totalLeads * 100) : null;
  const alphaSum = hs.reduce((s, st) => s + (G_SCORE[st.growth_trend ?? 'unknown'] ?? 30), 0);
  const hubMomentum = count ? Math.round(alphaSum / count) : null;

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

function fmtCapital(m: number | null): string {
  if (m == null) return '—';
  if (m >= 1000) return `$${(m / 1000).toFixed(1)}B`;
  if (m >= 1) return `$${m.toFixed(0)}M`;
  if (m > 0) return '<$1M';
  return '$0';
}

function fmtTalent(n: number | null): string {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

export function GlobalTechHubMap({
  startups, investors, loading,
  selectedHub, onSelectHub,
  sector, onSectorChange,
}: {
  startups: Startup[];
  investors: InvestorRow[];
  loading: boolean;
  selectedHub: string | null;
  onSelectHub: (hubId: string | null) => void;
  sector: SectorKey;
  onSectorChange: (sector: SectorKey) => void;
}) {
  const [hoveredHub, setHoveredHub] = useState<string | null>(null);

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
    <div className="bg-white border border-gray-100 rounded-[20px] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">

      {/* ── CSS ─────────────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes hub-ping {
          0%   { transform: scale(1);   opacity: 0.5; }
          75%  { transform: scale(2.4); opacity: 0; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        .hub-ping-ring {
          animation: hub-ping 2.4s cubic-bezier(0,0,0.2,1) infinite;
          transform-box: fill-box;
          transform-origin: center;
        }
        @keyframes ticker-scroll { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        .ticker-track { animation: ticker-scroll 70s linear infinite; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 py-5 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-[#0F172A] tracking-tight">Global Capital Flow</h2>
          <p className="text-sm text-gray-500 mt-0.5">Cross-border investment activity across tech ecosystems</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SECTOR_LABELS) as SectorKey[]).map(k => (
            <button
              key={k}
              onClick={() => onSectorChange(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 whitespace-nowrap ${
                sector === k
                  ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-sm'
                  : 'bg-gray-50 border-gray-100 text-gray-500 hover:border-gray-300 hover:text-[#0F172A]'
              }`}
            >
              {SECTOR_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Map + Panel ─────────────────────────────────────────────────────── */}
      {/* items-start is the actual fix: a flex row's default (align-items:
          stretch) forces every child — including the map wrapper — to grow
          to match the tallest sibling (the side panel once hub stats +
          insights render). That stretched wrapper then had empty space
          below the map, because the SVG inside only ever sizes itself to
          its own width:100%/height:auto aspect ratio and can't stretch to
          fill it. items-start lets each child size to its own content, so
          the map wrapper's height comes solely from the SVG's intrinsic
          aspect ratio — never taller, and never cropped. */}
      <div className="flex flex-col lg:flex-row lg:items-start">

        <div className="flex-1 relative overflow-hidden bg-[#F8FAFB]">
          <ComposableMap
            projection="geoEquirectangular"
            projectionConfig={{ scale: MAP_SCALE, center: MAP_CENTER }}
            width={MAP_W}
            height={MAP_H}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map(geo => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#DCE6EA"
                    stroke="#C7D3D8"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: 'none' },
                      hover:   { outline: 'none', fill: '#C9D8DE' },
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
                  onClick={() => onSelectHub(selectedHub === hub.id ? null : hub.id)}
                >
                  <g className="cursor-pointer">
                    <circle r={18} fill="transparent" />
                    {isSelected && (
                      <circle r={r + 7} fill="rgba(124,137,103,0.14)" stroke="rgba(124,137,103,0.4)" strokeWidth={1.5} />
                    )}
                    {/* Continuous low-opacity "ping" ring — gentle, uninterrupted radar pulse */}
                    <circle
                      className="hub-ping-ring"
                      r={r}
                      fill="rgba(124,137,103,0.4)"
                    />
                    <circle
                      r={isSelected || isHovered ? r + 2 : r}
                      fill="#7C8967"
                      fillOpacity={isSelected ? 1 : isHovered ? 0.9 : 0.75}
                      stroke={isSelected ? '#5C6A4C' : '#F8FAFB'}
                      strokeWidth={isSelected ? 2 : 1.5}
                      style={{ transition: 'r 0.2s ease, fill-opacity 0.2s ease' }}
                    />
                    {(isSelected || isHovered) && (
                      <text
                        textAnchor="middle"
                        y={-(r + 12)}
                        fontSize={8}
                        fontWeight={700}
                        fill="#0F172A"
                        letterSpacing="0.1em"
                        className="pointer-events-none uppercase"
                        style={{ filter: 'drop-shadow(0 1px 2px rgba(255,255,255,0.8))' }}
                      >
                        {hub.name}
                      </text>
                    )}
                  </g>
                </Marker>
              );
            })}
          </ComposableMap>

          {/* Legend */}
          <div className="absolute bottom-3 left-4 flex items-center gap-4 pointer-events-none">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#7C8967' }} />
              <span className="text-[10px] text-gray-500">Tech Hub</span>
            </div>
            <span className="text-[10px] text-gray-400">Click a hub to explore</span>
          </div>

          {loading && (
            <div className="absolute top-4 right-4 flex items-center gap-2 text-xs text-amber-600 pointer-events-none">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Loading data…
            </div>
          )}
        </div>

        {/* ── Side Panel ───────────────────────────────────────────────────── */}
        <div className="w-full lg:w-[340px] shrink-0 flex flex-col border-l border-gray-100">
          {activeHub && hubStats && insights ? (
            <>
              {/* Hub header */}
              <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100">
                <div>
                  <h3 className="text-lg font-bold text-[#0F172A]">{activeHub.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{activeHub.region}</p>
                </div>
                <button
                  onClick={() => onSelectHub(null)}
                  className="text-gray-400 hover:text-[#0F172A] transition-colors mt-0.5 text-xl leading-none"
                >
                  ×
                </button>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-px bg-gray-100 border-b border-gray-100">
                {[
                  { label: 'Companies',    value: hubStats.companies.toLocaleString(), empty: false },
                  { label: 'Unicorns',     value: hubStats.unicorns == null ? '—' : String(hubStats.unicorns), empty: hubStats.unicorns == null },
                  { label: 'Total Capital',value: fmtCapital(hubStats.capital), empty: hubStats.capital == null },
                  { label: 'Avg Alpha',    value: hubStats.avgAlpha == null ? '—' : String(hubStats.avgAlpha), empty: hubStats.avgAlpha == null },
                  { label: 'Velocity',     value: hubStats.velocity == null ? '—' : `${hubStats.velocity}%`, empty: hubStats.velocity == null },
                  { label: 'Talent Pool',  value: fmtTalent(hubStats.talent), empty: hubStats.talent == null },
                ].map(stat => (
                  <div key={stat.label} className="flex flex-col px-5 py-4 bg-white">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">{stat.label}</span>
                    <span className={`text-xl font-bold ${stat.empty ? 'text-gray-300' : 'text-[#0F172A]'}`}>{stat.value}</span>
                  </div>
                ))}
              </div>
              {hubStats.companies === 0 && (
                <p className="px-6 py-3 text-[11px] text-gray-400 bg-gray-50 border-b border-gray-100">
                  No companies on record for this hub in the current sector filter.
                </p>
              )}
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mb-5 bg-[#7C8967]/[0.08] border border-[#7C8967]/25">
                <svg viewBox="0 0 24 24" fill="none" stroke="#7C8967" strokeWidth={1.5} className="w-6 h-6">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Select a Hub</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                Click any pulsing dot on the map to explore hub analytics and ecosystem health metrics.
              </p>
              {loading && (
                <div className="flex items-center gap-2 mt-5 text-xs text-amber-600">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Fetching ecosystem data…
                </div>
              )}
              {!loading && startups.length > 0 && (
                <div className="mt-5 grid grid-cols-2 gap-3 w-full max-w-[220px]">
                  <div className="rounded-xl p-3 text-center bg-gray-50 border border-gray-100">
                    <div className="text-base font-bold text-[#0F172A]">{startups.length}</div>
                    <div className="text-[9px] text-gray-400 uppercase tracking-wider">Startups</div>
                  </div>
                  <div className="rounded-xl p-3 text-center bg-gray-50 border border-gray-100">
                    <div className="text-base font-bold text-[#0F172A]">{investors.length}</div>
                    <div className="text-[9px] text-gray-400 uppercase tracking-wider">Investors</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Alpha Insights + Ecosystem Health — combined horizontal data row
           underneath the map, keeping the side panel to just header + stats
           so it never dramatically outgrows the map's natural height ── */}
      {activeHub && insights && (
        <div className="px-6 py-5 border-t border-gray-100 bg-gray-50">
          <h4 className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-4">
            Alpha Insights &amp; Ecosystem Health · <span className="text-gray-600">{activeHub.name}</span>
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4">
            {[
              { label: 'Capital Concentration', value: insights.capitalConcentration, suffix: '%', color: '#7C8967' },
              { label: 'Market Rating',          value: insights.marketRating,          suffix: '%', color: '#7C8967' },
              { label: 'Talent Signal',          value: insights.talentSignal,          suffix: '%', color: '#7C8967' },
              { label: 'Local Capital',          value: insights.localCapitalPct,       suffix: '%', color: '#5B8CA6' },
              { label: 'Hub Momentum',           value: insights.hubMomentum,           suffix: '',  color: '#5B8CA6' },
              { label: 'Cross-Border Index',     value: insights.crossBorderIndex,      suffix: '%', color: '#5B8CA6' },
            ].map(item => {
              const hasVal = item.value != null;
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-gray-400">{item.label}</span>
                    <span className={`text-xs font-bold ${hasVal ? 'text-[#0F172A]' : 'text-gray-300'}`}>
                      {hasVal ? `${item.value}${item.suffix}` : '—'}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-gray-200">
                    {hasVal && (
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(100, item.value as number)}%`, background: item.color, transition: 'width .6s ease' }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Ticker ──────────────────────────────────────────────────────────── */}
      {ticker.length > 0 && (
        <div className="flex items-center overflow-hidden border-t border-gray-100 bg-gray-50">
          <div className="shrink-0 px-4 py-2 flex items-center gap-1.5 border-r border-gray-100">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-600">Live</span>
          </div>
          <div className="overflow-hidden flex-1">
            <div className="ticker-track flex gap-16 py-2 whitespace-nowrap">
              {[...ticker, ...ticker].map((item, i) => (
                <span key={i} className="text-[11px] text-gray-500 shrink-0">
                  <span className="text-[#7C8967]/70 mr-1.5">◆</span>{item}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
