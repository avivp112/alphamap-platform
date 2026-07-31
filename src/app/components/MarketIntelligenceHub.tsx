import React, { useMemo } from 'react';
import { useTranslation } from "react-i18next";
import {
  AlertCircle, DollarSign, TrendingUp, Activity, Landmark, Layers, Zap,
} from 'lucide-react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip as ReTooltip, ResponsiveContainer, LineChart, Line,
  BarChart, Bar,
} from 'recharts';
import type { Startup, InvestorRow, FundingRound } from '../../lib/supabase';
import {
  resolveHub, matchesSector, HUB_BY_ID, SECTOR_LABELS, type SectorKey,
} from './GlobalTechHubMap';

// ─────────────────────────────────────────────────────────────────────────────
// Market Intelligence Hub — sits beneath the Global Capital Flow map on the
// Market Map page. Reacts to the same hub/sector filters the map exposes and
// derives every metric below from real Startups / Investors / Funding Rounds
// data — nothing here is mocked. Any widget without enough data in the
// current filter context falls back to "—" or a MissingDataState card
// rather than fabricating a number.
// ─────────────────────────────────────────────────────────────────────────────

function MissingDataState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 bg-amber-50/60 border border-amber-200/60 rounded-[12px] px-4 py-3.5">
      <AlertCircle className="w-4 h-4 text-amber-500 flex-none mt-0.5" />
      <p className="text-xs text-amber-800/80 leading-relaxed">{message}</p>
    </div>
  );
}

function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white border border-gray-100 rounded-[20px] shadow-[0_1px_3px_rgba(15,23,42,0.04)] p-5 ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-4 h-4 text-[#F59E0B]" />
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{title}</h3>
      {subtitle && <span className="text-[9px] text-gray-300 ml-auto">{subtitle}</span>}
    </div>
  );
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmtUsd(v: number | null): string {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtUsdCompact(millions: number | null): string {
  if (millions == null || !isFinite(millions)) return '—';
  return millions >= 1000 ? `$${(millions / 1000).toFixed(1)}B` : `$${millions.toFixed(0)}M`;
}

// Third local copy of this parsing helper (VCs.tsx / PrivateEquity.tsx each
// have their own) — scoped to this file to avoid touching shipped pages.
function parseAumMillions(fundSize: string | null | undefined): number | null {
  if (!fundSize) return null;
  const b = fundSize.match(/\$?([\d.]+)B/i);
  if (b) return Math.round(parseFloat(b[1]) * 1_000);
  const m = fundSize.match(/\$?([\d.]+)M/i);
  if (m) return Math.round(parseFloat(m[1]));
  return null;
}

const FIRM_TYPE_LABEL: Record<string, string> = { vc: 'VC', pe: 'PE', growth: 'Growth' };
const FIRM_TYPE_COLOR: Record<string, string> = { vc: '#F59E0B', pe: '#6366F1', growth: '#10B981' };

const VC_ROUND_TYPES = new Set([
  'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Series E+',
  'Growth', 'Bridge', 'Convertible Note', 'Bootstrapped', 'Grant',
]);
const PE_ROUND_TYPES = new Set(['PE Buyout', 'Secondary']);

function totalRaised(s: Startup): number {
  return s.funding_rounds.reduce((sum, fr) => sum + (fr.amount_raised ?? 0), 0);
}

function capitalPerEmployee(list: Startup[]): { value: number | null; companies: number } {
  let capital = 0, headcount = 0, companies = 0;
  for (const s of list) {
    if (s.employee_count == null || s.employee_count <= 0) continue;
    capital += totalRaised(s);
    headcount += s.employee_count;
    companies++;
  }
  return { value: headcount > 0 ? capital / headcount : null, companies };
}

function monthsBetween(d1: string, d2: string): number {
  const a = new Date(d1), b = new Date(d2);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function earliestRound(rounds: FundingRound[], type: string): FundingRound | undefined {
  return rounds
    .filter(fr => fr.round_type === type && fr.announcement_date)
    .sort((a, b) => (a.announcement_date as string).localeCompare(b.announcement_date as string))[0];
}

export function MarketIntelligenceHub({
  startups, investors, loading, selectedHub, sector,
}: {
  startups: Startup[];
  investors: InvestorRow[];
  loading: boolean;
  selectedHub: string | null;
  sector: SectorKey;
}) {
  const { t } = useTranslation();
  const filtered = useMemo(
    () => startups.filter(s =>
      (!selectedHub || resolveHub(s.city, s.country) === selectedHub) && matchesSector(s, sector)
    ),
    [startups, selectedHub, sector]
  );

  const hubLabel = selectedHub ? HUB_BY_ID[selectedHub]?.name ?? 'Selected Hub' : 'Global';
  const isFiltered = selectedHub != null || sector !== 'all';

  // ── Module 1: Pricing Radar ──────────────────────────────────────────────

  const segmentCPE = useMemo(() => capitalPerEmployee(filtered), [filtered]);
  const globalCPE = useMemo(() => capitalPerEmployee(startups), [startups]);

  const cpeDelta = useMemo(() => {
    if (segmentCPE.value == null || globalCPE.value == null || globalCPE.value === 0 || !isFiltered) return null;
    return ((segmentCPE.value - globalCPE.value) / globalCPE.value) * 100;
  }, [segmentCPE, globalCPE, isFiltered]);

  const currentYear = new Date().getFullYear();
  const scatterData = useMemo(() => {
    return filtered
      .filter(s => s.founded_year != null && s.founded_year > 1900 && s.founded_year <= currentYear)
      .map(s => ({
        name: s.name,
        yearsActive: currentYear - (s.founded_year as number),
        fundingM: totalRaised(s) / 1e6,
        headcount: s.employee_count && s.employee_count > 0 ? s.employee_count : 5,
        hasHeadcount: s.employee_count != null && s.employee_count > 0,
      }));
  }, [filtered, currentYear]);

  // ── Module 2: The Pulse ──────────────────────────────────────────────────

  const velocity = useMemo(() => {
    const diffs: number[] = [];
    for (const s of filtered) {
      const seed = earliestRound(s.funding_rounds, 'Seed');
      const seriesA = earliestRound(s.funding_rounds, 'Series A');
      if (!seed || !seriesA) continue;
      const m = monthsBetween(seed.announcement_date as string, seriesA.announcement_date as string);
      if (m > 0) diffs.push(m);
    }
    return {
      avgMonths: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
      sample: diffs.length,
    };
  }, [filtered]);

  const momentumData = useMemo(() => {
    const buckets: Record<string, { month: string; vc: number; pe: number }> = {};
    for (const s of filtered) {
      for (const fr of s.funding_rounds) {
        if (!fr.announcement_date || !fr.round_type) continue;
        const isVc = VC_ROUND_TYPES.has(fr.round_type);
        const isPe = PE_ROUND_TYPES.has(fr.round_type);
        if (!isVc && !isPe) continue;
        const month = fr.announcement_date.slice(0, 7);
        if (!buckets[month]) buckets[month] = { month, vc: 0, pe: 0 };
        if (isVc) buckets[month].vc++; else buckets[month].pe++;
      }
    }
    return Object.values(buckets).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }, [filtered]);

  // ── Module 3: Dry Powder ─────────────────────────────────────────────────

  const capitalSupply = useMemo(() => {
    const dealCount: Record<string, number> = {};
    for (const s of filtered) {
      for (const fr of s.funding_rounds) {
        const names = new Set<string>();
        if (fr.lead_investor) names.add(fr.lead_investor.trim());
        for (const n of fr.investors ?? []) if (n) names.add(n.trim());
        for (const n of names) {
          const key = n.toLowerCase();
          dealCount[key] = (dealCount[key] ?? 0) + 1;
        }
      }
    }
    const activeSet = new Set(Object.keys(dealCount));
    const matched = investors
      .filter(inv => activeSet.has(inv.name.toLowerCase().trim()))
      .map(inv => ({
        inv,
        deals: dealCount[inv.name.toLowerCase().trim()] ?? 0,
        aum: parseAumMillions(inv.fund_size),
      }));

    const totalAum = matched.reduce((sum, m) => sum + (m.aum ?? 0), 0);
    const hasAny = matched.some(m => m.aum != null);

    const stack: Record<string, number> = { vc: 0, pe: 0, growth: 0 };
    for (const m of matched) {
      if (m.aum == null) continue;
      const t = m.inv.firm_type ?? 'vc';
      stack[t] = (stack[t] ?? 0) + m.aum;
    }

    const topPlayers = [...matched]
      .sort((a, b) => (b.deals - a.deals) || ((b.aum ?? 0) - (a.aum ?? 0)))
      .slice(0, 5);

    return { matched, totalAum: hasAny ? totalAum : null, stack, topPlayers };
  }, [filtered, investors]);

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          Loading market intelligence…
        </div>
      </Card>
    );
  }

  return (
    <div data-tour="market-intelligence">
      <div className="mb-5">
        <h2 className="text-lg font-bold tracking-tight text-[#0F172A]">{t("mih.title")}</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          {SECTOR_LABELS[sector]} · {hubLabel} · {filtered.length.toLocaleString()} {filtered.length === 1 ? 'company' : 'companies'} in view
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        {/* ── Module 1: Pricing Radar ── */}
        <Card className="lg:col-span-4 flex flex-col">
          <CardHeader icon={DollarSign} title="Capital / Employee" subtitle="Proxy multiple" />
          {segmentCPE.value != null ? (
            <>
              <span className="text-3xl font-bold text-gray-900 tracking-tight">{fmtUsd(segmentCPE.value)}</span>
              <span className="text-[11px] text-gray-400 mt-1">per employee · {segmentCPE.companies} companies</span>
              {cpeDelta != null ? (
                <div className={`mt-3 inline-flex items-center gap-1 self-start px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                  cpeDelta >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}>
                  <TrendingUp className={`w-3 h-3 ${cpeDelta < 0 ? 'rotate-180' : ''}`} />
                  {cpeDelta >= 0 ? '+' : ''}{cpeDelta.toFixed(0)}% vs global avg
                </div>
              ) : (
                <span className="mt-3 text-[11px] text-gray-300">Global avg: {fmtUsd(globalCPE.value)}</span>
              )}
            </>
          ) : (
            <MissingDataState message="No companies in this segment have both disclosed funding and a recorded headcount yet." />
          )}
        </Card>

        <Card className="lg:col-span-8">
          <CardHeader icon={TrendingUp} title="Market Map — Funding vs. Maturity" subtitle="Bubble size = headcount" />
          {scatterData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  type="number" dataKey="yearsActive" name="Years Active" unit="y"
                  tick={{ fill: '#6B7280', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false}
                />
                <YAxis
                  type="number" dataKey="fundingM" name="Total Funding"
                  tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`}
                  tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={false} tickLine={false} width={56}
                />
                <ZAxis type="number" dataKey="headcount" range={[40, 400]} name="Headcount" />
                <ReTooltip
                  cursor={{ strokeDasharray: '4 2', stroke: '#F59E0B' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as typeof scatterData[number];
                    return (
                      <div className="bg-white border border-gray-100 rounded-[10px] shadow-lg px-3 py-2 text-xs">
                        <p className="font-bold text-gray-900">{d.name}</p>
                        <p className="text-gray-500">{d.yearsActive}y active · {fmtUsdCompact(d.fundingM)} raised</p>
                        <p className="text-gray-400">{d.hasHeadcount ? `${d.headcount} employees` : 'Headcount unknown'}</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} fill="#F59E0B" fillOpacity={0.65} stroke="#F59E0B" />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <MissingDataState message="No companies in this segment have a recorded founding year to plot." />
          )}
        </Card>

        {/* ── Module 2: The Pulse ── */}
        <Card className="lg:col-span-5 flex flex-col">
          <CardHeader icon={Zap} title="Funding Velocity" subtitle="Seed → Series A" />
          {velocity.avgMonths != null ? (
            <>
              <span className="text-3xl font-bold text-gray-900 tracking-tight">{velocity.avgMonths.toFixed(1)} <span className="text-lg font-semibold text-gray-400">mo</span></span>
              <span className="text-[11px] text-gray-400 mt-1">avg. across {velocity.sample} {velocity.sample === 1 ? 'company' : 'companies'} with both rounds dated</span>
            </>
          ) : (
            <MissingDataState message="No companies in this segment have both a dated Seed and a dated Series A round yet." />
          )}
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader icon={Activity} title="Deal Momentum" subtitle={t("mih.vcVsPe")} />
          {momentumData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={momentumData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                <ReTooltip
                  cursor={{ stroke: '#E5E7EB', strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-white border border-gray-100 rounded-[10px] shadow-lg px-3 py-2 text-xs">
                        <p className="font-bold text-gray-900 mb-1">{label}</p>
                        {payload.map(p => (
                          <p key={p.dataKey as string} style={{ color: p.color }}>{p.dataKey === 'vc' ? 'VC rounds' : 'PE Buyout / Secondary'}: {p.value as number}</p>
                        ))}
                      </div>
                    );
                  }}
                />
                <Line type="monotone" dataKey="vc" name={t("mih.vcRounds")} stroke="#F59E0B" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="pe" name={t("mih.peSecondary")} stroke="#6366F1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <MissingDataState message="No dated VC or PE transactions on record for this segment yet." />
          )}
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400"><span className="w-2 h-2 rounded-full bg-[#F59E0B]" />VC rounds</span>
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400"><span className="w-2 h-2 rounded-full bg-[#6366F1]" />PE Buyout / Secondary</span>
          </div>
        </Card>

        {/* ── Module 3: Dry Powder ── */}
        <Card className="lg:col-span-3 flex flex-col">
          <CardHeader icon={Landmark} title="Available Capital" subtitle="Active investor AUM" />
          {capitalSupply.totalAum != null ? (
            <>
              <span className="text-3xl font-bold text-gray-900 tracking-tight">{fmtUsdCompact(capitalSupply.totalAum)}</span>
              <span className="text-[11px] text-gray-400 mt-1">across {capitalSupply.matched.length} active {capitalSupply.matched.length === 1 ? 'investor' : 'investors'}</span>
            </>
          ) : (
            <MissingDataState message="No fund-size data on record for investors active in this segment." />
          )}
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader icon={Layers} title="Capital Stack" subtitle="AUM by firm type" />
          {(capitalSupply.stack.vc + capitalSupply.stack.pe + capitalSupply.stack.growth) > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={72}>
                <BarChart
                  layout="vertical"
                  data={[{ name: 'AUM', vc: capitalSupply.stack.vc, pe: capitalSupply.stack.pe, growth: capitalSupply.stack.growth }]}
                  margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" hide />
                  <ReTooltip
                    cursor={{ fill: 'transparent' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-white border border-gray-100 rounded-[10px] shadow-lg px-3 py-2 text-xs">
                          {payload.map(p => (
                            <p key={p.dataKey as string} style={{ color: p.color }}>
                              {FIRM_TYPE_LABEL[p.dataKey as string]}: {fmtUsdCompact(p.value as number)}
                            </p>
                          ))}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="vc" stackId="a" fill={FIRM_TYPE_COLOR.vc} radius={[8, 0, 0, 8]} />
                  <Bar dataKey="pe" stackId="a" fill={FIRM_TYPE_COLOR.pe} />
                  <Bar dataKey="growth" stackId="a" fill={FIRM_TYPE_COLOR.growth} radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-1">
                {(['vc', 'pe', 'growth'] as const).map(t => (
                  <span key={t} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                    <span className="w-2 h-2 rounded-full" style={{ background: FIRM_TYPE_COLOR[t] }} />
                    {FIRM_TYPE_LABEL[t]} · {fmtUsdCompact(capitalSupply.stack[t] || null)}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <MissingDataState message="No fund-size data on record to break down by firm type yet." />
          )}
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader icon={DollarSign} title="Top Players" subtitle="By deal count" />
          {capitalSupply.topPlayers.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {capitalSupply.topPlayers.map((p, i) => (
                <li key={p.inv.id} className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-400 flex-none">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-900 truncate">{p.inv.name}</p>
                    <p className="text-[10px] text-gray-400">{p.deals} {p.deals === 1 ? 'deal' : 'deals'}{p.aum != null ? ` · ${fmtUsdCompact(p.aum)} AUM` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <MissingDataState message="No investor activity recorded for this segment yet." />
          )}
        </Card>

      </div>
    </div>
  );
}
