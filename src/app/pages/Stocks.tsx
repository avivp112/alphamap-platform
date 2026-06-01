import React, { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import {
  TrendingUp, TrendingDown, Search, X, RefreshCw,
  BarChart2, DollarSign, Activity, ExternalLink, AlertCircle,
} from 'lucide-react';

// ─── Config ──────────────────────────────────────────────────────────────────

const API_KEY = (import.meta as unknown as { env: Record<string, string> }).env.VITE_FMP_API_KEY ?? '';

const TRACKED_SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN',
  'META', 'TSLA', 'NFLX', 'ORCL', 'CRM',
  'SNOW', 'PLTR', 'UBER', 'ABNB', 'COIN',
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changesPercentage: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  volume: number;
  avgVolume: number;
  open: number;
  previousClose: number;
  pe: number | null;
  eps: number | null;
  exchange: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, prefix = ''): string {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e12) return `${prefix}${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9)  return `${prefix}${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6)  return `${prefix}${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3)  return `${prefix}${(n / 1e3).toFixed(1)}K`;
  return `${prefix}${n.toFixed(2)}`;
}

function pct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// ─── Stock Row ────────────────────────────────────────────────────────────────

function StockRow({ stock, onClick }: { stock: StockQuote; onClick: () => void }) {
  const up = stock.change >= 0;
  return (
    <tr
      onClick={onClick}
      className="border-b border-gray-50 hover:bg-amber-50/40 cursor-pointer transition-colors group"
    >
      <td className="py-4 pl-6 pr-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0F172A] text-white text-xs font-bold flex-shrink-0">
            {stock.symbol.slice(0, 2)}
          </div>
          <div>
            <div className="font-bold text-[#0F172A] text-sm group-hover:text-[#F59E0B] transition-colors">
              {stock.symbol}
            </div>
            <div className="text-xs text-gray-400 truncate max-w-[160px]">{stock.name}</div>
          </div>
        </div>
      </td>
      <td className="py-4 px-3 text-sm font-bold text-[#0F172A] tabular-nums">
        ${stock.price.toFixed(2)}
      </td>
      <td className="py-4 px-3">
        <span className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
          {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {pct(stock.changesPercentage)}
        </span>
      </td>
      <td className="py-4 px-3 text-sm text-gray-500 tabular-nums hidden sm:table-cell">
        {fmt(stock.marketCap, '$')}
      </td>
      <td className="py-4 px-3 text-sm text-gray-500 tabular-nums hidden md:table-cell">
        {fmt(stock.volume)}
      </td>
      <td className="py-4 px-3 text-sm text-gray-400 tabular-nums hidden lg:table-cell">
        ${stock.dayLow.toFixed(2)} – ${stock.dayHigh.toFixed(2)}
      </td>
      <td className="py-4 px-3 text-xs text-gray-400 hidden xl:table-cell">
        {stock.exchange}
      </td>
    </tr>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function StockDetail({ stock, onClose }: { stock: StockQuote; onClose: () => void }) {
  const up = stock.change >= 0;
  const yearRange = stock.yearHigh && stock.yearLow
    ? ((stock.price - stock.yearLow) / (stock.yearHigh - stock.yearLow)) * 100
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-[28px] shadow-[0_24px_60px_rgba(0,0,0,0.15)] w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-[#0F172A] p-8 pb-6">
          <button onClick={onClose} className="absolute top-5 right-5 text-white/40 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center text-white text-sm font-bold">
                  {stock.symbol.slice(0, 2)}
                </div>
                <div>
                  <h2 className="text-white text-xl font-bold">{stock.symbol}</h2>
                  <p className="text-white/50 text-xs">{stock.exchange}</p>
                </div>
              </div>
              <p className="text-white/70 text-sm mt-2 max-w-xs">{stock.name}</p>
            </div>
            <div className="text-right">
              <div className="text-white text-3xl font-bold tabular-nums">${stock.price.toFixed(2)}</div>
              <div className={`flex items-center justify-end gap-1 mt-1 text-sm font-bold tabular-nums ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
                {up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {stock.change > 0 ? '+' : ''}{stock.change.toFixed(2)} ({pct(stock.changesPercentage)})
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-8 space-y-6">
          {/* Key metrics */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Market Cap',   value: fmt(stock.marketCap, '$'),       icon: DollarSign },
              { label: 'Volume',       value: fmt(stock.volume),                icon: Activity   },
              { label: 'P/E Ratio',    value: stock.pe ? stock.pe.toFixed(2) : '—', icon: BarChart2  },
              { label: 'EPS',          value: stock.eps ? `$${stock.eps.toFixed(2)}` : '—', icon: TrendingUp },
              { label: 'Open',         value: `$${stock.open.toFixed(2)}`,      icon: TrendingUp },
              { label: 'Prev. Close',  value: `$${stock.previousClose.toFixed(2)}`, icon: TrendingDown },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-[#F8FAFC] rounded-xl p-3.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
                </div>
                <span className="text-sm font-bold text-[#0F172A] tabular-nums">{value}</span>
              </div>
            ))}
          </div>

          {/* 52-week range */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-2">
              <span className="font-semibold">52-Week Range</span>
              <span className="tabular-nums">${stock.yearLow.toFixed(2)} – ${stock.yearHigh.toFixed(2)}</span>
            </div>
            <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-rose-400 to-emerald-400 rounded-full" style={{ width: '100%' }} />
              {yearRange != null && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white border-2 border-[#F59E0B] shadow-sm"
                  style={{ left: `calc(${Math.min(Math.max(yearRange, 2), 98)}% - 8px)` }}
                />
              )}
            </div>
          </div>

          {/* Day range */}
          <div className="flex items-center justify-between text-sm bg-[#F8FAFC] rounded-xl px-4 py-3">
            <span className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Today's Range</span>
            <span className="font-bold text-[#0F172A] tabular-nums">
              ${stock.dayLow.toFixed(2)} – ${stock.dayHigh.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Stocks() {
  const [quotes, setQuotes]       = useState<StockQuote[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState<StockQuote | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function fetchQuotes() {
    if (!API_KEY) {
      setError('no_key');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const symbols = TRACKED_SYMBOLS.join(',');
      const res = await fetch(
        `https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${API_KEY}`
      );
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data: StockQuote[] = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected API response');
      // Sort by market cap descending
      data.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
      setQuotes(data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stocks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchQuotes(); }, []);

  const filtered = quotes.filter(s =>
    !search ||
    s.symbol.toLowerCase().includes(search.toLowerCase()) ||
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const gainers = quotes.filter(s => s.change > 0).length;
  const losers  = quotes.filter(s => s.change < 0).length;

  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">

            {/* Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">Stocks</h1>
                <p className="mt-1 sm:mt-2 text-sm font-medium text-gray-500">
                  Live quotes for tracked tech equities.
                  {lastUpdated && (
                    <span className="ml-2 text-gray-300">
                      Updated {lastUpdated.toLocaleTimeString()}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={fetchQuotes}
                disabled={loading}
                className="flex items-center gap-2 rounded-[16px] border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-[#0F172A] hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {/* Summary chips */}
            {quotes.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-6">
                <div className="bg-white rounded-[12px] border border-gray-100 px-4 py-2.5 shadow-sm">
                  <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide mr-2">Tracking</span>
                  <span className="text-sm font-bold text-[#0F172A]">{quotes.length} stocks</span>
                </div>
                <div className="bg-emerald-50 rounded-[12px] border border-emerald-100 px-4 py-2.5">
                  <span className="text-xs text-emerald-600 font-semibold uppercase tracking-wide mr-2">Gaining</span>
                  <span className="text-sm font-bold text-emerald-700">{gainers}</span>
                </div>
                <div className="bg-rose-50 rounded-[12px] border border-rose-100 px-4 py-2.5">
                  <span className="text-xs text-rose-600 font-semibold uppercase tracking-wide mr-2">Declining</span>
                  <span className="text-sm font-bold text-rose-700">{losers}</span>
                </div>
              </div>
            )}

            {/* No API key state */}
            {error === 'no_key' ? (
              <div className="bg-white rounded-[24px] border border-amber-100 p-10 text-center shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
                  <BarChart2 className="w-6 h-6 text-[#F59E0B]" />
                </div>
                <h2 className="text-lg font-bold text-[#0F172A] mb-2">Add your FMP API key</h2>
                <p className="text-sm text-gray-500 max-w-sm mx-auto mb-5 leading-relaxed">
                  Get a free key at{' '}
                  <a href="https://financialmodelingprep.com/developer/docs" target="_blank" rel="noreferrer" className="text-[#F59E0B] font-semibold hover:underline inline-flex items-center gap-0.5">
                    financialmodelingprep.com <ExternalLink className="w-3 h-3" />
                  </a>
                  , then add it to your Netlify environment variables:
                </p>
                <div className="inline-block bg-[#F3F4F6] rounded-xl px-5 py-3 font-mono text-sm text-[#0F172A] select-all">
                  VITE_FMP_API_KEY=your_key_here
                </div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center py-24 gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm font-semibold text-[#0F172A]">{error}</p>
                <button onClick={fetchQuotes} className="text-xs text-[#F59E0B] font-medium hover:underline">Try again</button>
              </div>
            ) : loading ? (
              <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm overflow-hidden">
                {TRACKED_SYMBOLS.map(sym => (
                  <div key={sym} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 animate-pulse">
                    <div className="h-9 w-9 rounded-xl bg-gray-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-16 bg-gray-100 rounded" />
                      <div className="h-2.5 w-32 bg-gray-50 rounded" />
                    </div>
                    <div className="h-4 w-20 bg-gray-100 rounded" />
                    <div className="h-4 w-14 bg-gray-100 rounded hidden sm:block" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Search */}
                <div className="relative mb-5 max-w-sm">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search symbol or company…"
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-[12px] focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/10 transition-all"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Table */}
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Company', 'Price', 'Change', 'Market Cap', 'Volume', "Day's Range", 'Exchange'].map((h, i) => (
                          <th
                            key={h}
                            className={`py-3.5 px-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 ${i === 0 ? 'pl-6' : ''} ${i === 3 ? 'hidden sm:table-cell' : ''} ${i === 4 ? 'hidden md:table-cell' : ''} ${i === 5 ? 'hidden lg:table-cell' : ''} ${i === 6 ? 'hidden xl:table-cell' : ''}`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(s => (
                        <StockRow key={s.symbol} stock={s} onClick={() => setSelected(s)} />
                      ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && (
                    <div className="py-16 text-center text-sm text-gray-400">No results for "{search}"</div>
                  )}
                </div>
              </>
            )}

          </div>

      {selected && <StockDetail stock={selected} onClose={() => setSelected(null)} />}
    </Layout>
  );
}
