import React, { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { Layout } from "../components/Layout";
import {
  Plus, Globe, Loader2, Search, X, MapPin, Calendar, Users,
  DollarSign, Rocket, AlertCircle, CheckCircle2,
  TrendingUp, UserRound, LayoutGrid, List, ExternalLink,
  ChevronDown, Building2, SlidersHorizontal, CheckSquare, Square,
} from "lucide-react";
import { fetchStartups, ingestStartup, type Startup, type FundingRound, type RoundType } from "../../lib/supabase";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(usd: number | null | undefined): string {
  if (!usd) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd}`;
}

function fmtM(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}B`;
  if (usd >= 1) return `$${usd.toFixed(0)}M`;
  return `$${(usd * 1000).toFixed(0)}K`;
}

function fmtEmp(n: number | null): string {
  if (!n) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function avatarColor(name: string): string {
  const colors = [
    "bg-violet-100 text-violet-700",
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700",
    "bg-indigo-100 text-indigo-700",
    "bg-teal-100 text-teal-700",
    "bg-orange-100 text-orange-700",
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[h % colors.length];
}

const ROUND_STYLE: Record<string, string> = {
  "Pre-Seed":         "bg-purple-50 text-purple-700 border border-purple-100",
  "Seed":             "bg-blue-50 text-blue-700 border border-blue-100",
  "Series A":         "bg-emerald-50 text-emerald-700 border border-emerald-100",
  "Series B":         "bg-amber-50 text-amber-700 border border-amber-100",
  "Series C":         "bg-orange-50 text-orange-700 border border-orange-100",
  "Series D":         "bg-orange-100 text-orange-800 border border-orange-200",
  "Series E+":        "bg-red-50 text-red-700 border border-red-100",
  "Growth":           "bg-indigo-50 text-indigo-700 border border-indigo-100",
  "Bridge":           "bg-sky-50 text-sky-700 border border-sky-100",
  "Convertible Note": "bg-cyan-50 text-cyan-700 border border-cyan-100",
  "Bootstrapped":     "bg-teal-50 text-teal-700 border border-teal-100",
  "Grant":            "bg-lime-50 text-lime-700 border border-lime-100",
  "Acquired":         "bg-gray-100 text-gray-600 border border-gray-200",
  "Other":            "bg-gray-50 text-gray-500 border border-gray-100",
};

const ROUND_HEX: Record<string, string> = {
  "Pre-Seed":         "#7C3AED",
  "Seed":             "#2563EB",
  "Series A":         "#059669",
  "Series B":         "#D97706",
  "Series C":         "#EA580C",
  "Series D":         "#C2410C",
  "Series E+":        "#DC2626",
  "Growth":           "#4338CA",
  "Bridge":           "#0284C7",
  "Convertible Note": "#0891B2",
  "Bootstrapped":     "#0D9488",
  "Grant":            "#65A30D",
  "Acquired":         "#6B7280",
  "Other":            "#9CA3AF",
};

const ALL_ROUND_TYPES: RoundType[] = [
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C",
  "Series D", "Series E+", "Growth", "Bridge", "Convertible Note",
  "Bootstrapped", "Grant", "Acquired", "Other",
];

const EMP_BUCKETS = [
  { label: "All sizes", value: "all" },
  { label: "< 50",      value: "<50" },
  { label: "50–200",    value: "50-200" },
  { label: "200–1k",    value: "200-1k" },
  { label: "1k+",       value: "1k+" },
] as const;
type EmpBucket = (typeof EMP_BUCKETS)[number]["value"];

const PROGRESS_MESSAGES = [
  "Searching the web for funding data…",
  "Analyzing founding team & leadership…",
  "Identifying headquarters location…",
  "Scanning job boards for hiring signals…",
  "Validating entry conditions…",
  "Saving to AlphaMap…",
];

// ── Funding Chart ─────────────────────────────────────────────────────────────

interface ChartBar {
  label: string;
  amount: number;
  valuation: number | null;
  roundType: string;
  color: string;
}

function buildChartData(rounds: FundingRound[]): ChartBar[] {
  return rounds
    .filter((r) => r.amount_raised && r.amount_raised > 0)
    .sort((a, b) => (a.announcement_date ?? "").localeCompare(b.announcement_date ?? ""))
    .map((r) => {
      const year = r.announcement_date
        ? `'${new Date(r.announcement_date).getFullYear().toString().slice(2)}`
        : "";
      const rt = r.round_type ?? "Other";
      return {
        label: year ? `${rt} ${year}` : rt,
        amount: r.amount_raised! / 1e6,
        valuation: r.valuation ? r.valuation / 1e6 : null,
        roundType: rt,
        color: ROUND_HEX[rt] ?? ROUND_HEX["Other"],
      };
    });
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartBar; value: number }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#0F172A] text-white rounded-[10px] px-3 py-2 text-xs shadow-xl border border-white/10">
      <p className="font-bold mb-1">{d.label}</p>
      <p className="text-[#F59E0B]">{fmtM(d.amount)} raised</p>
      {d.valuation && <p className="text-gray-300">{fmtM(d.valuation)} valuation</p>}
    </div>
  );
}

function FundingChart({ rounds }: { rounds: FundingRound[] }) {
  const data = buildChartData(rounds);
  if (data.length === 0) return null;

  const maxVal = Math.max(...data.map((d) => d.amount));
  const tickFmt = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`);
  const domainMax = Math.ceil(maxVal * 1.2 / 100) * 100 || 10;

  return (
    <div className="mt-1 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-[#F59E0B]" />
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Funding History</h4>
      </div>
      <div className="bg-[#091422] rounded-[16px] p-4 border border-[#1a2a3f]">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap="35%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1a2a3f" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#64748b", fontSize: 10, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={tickFmt}
              tick={{ fill: "#475569", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={56}
              domain={[0, domainMax]}
            />
            <ReTooltip content={<ChartTooltip />} cursor={{ fill: "#0d1f35" }} />
            <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={48}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function StartupDetailModal({ startup, onClose }: { startup: Startup; onClose: () => void }) {
  const latestRound = startup.funding_rounds?.[0] ?? null;
  const roundType = latestRound?.round_type ?? null;
  const roundStyle = roundType ? (ROUND_STYLE[roundType] ?? ROUND_STYLE["Other"]) : null;
  const location = [startup.city, startup.country].filter(Boolean).join(", ") || null;
  const sortedRounds = [...(startup.funding_rounds ?? [])].sort(
    (a, b) => (a.announcement_date ?? "").localeCompare(b.announcement_date ?? ""),
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0b1626] rounded-[24px] shadow-[0_32px_80px_rgba(0,0,0,0.6)] w-full max-w-2xl max-h-[92vh] overflow-y-auto border border-[#1a2a3f]">

        {/* Header */}
        <div className="bg-[#060e1a] rounded-t-[24px] p-7 text-white border-b border-[#1a2a3f]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black flex-none ${avatarColor(startup.name)}`}>
                {startup.name[0].toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-bold leading-tight">{startup.name}</h2>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {startup.industry && (
                    <span className="text-xs text-gray-400 font-medium">{startup.industry}</span>
                  )}
                  {location && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <MapPin className="w-3 h-3" />{location}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-none">
              {roundType && roundStyle && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${roundStyle}`}>
                  {roundType}
                </span>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-7">
          {startup.description && (
            <p className="text-sm text-slate-300 leading-relaxed mb-7">{startup.description}</p>
          )}

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
            {[
              { icon: TrendingUp, label: "Valuation",    value: fmt(latestRound?.valuation) },
              { icon: DollarSign, label: "Total Raised", value: fmt(latestRound?.amount_raised) },
              { icon: Users,      label: "Employees",    value: fmtEmp(startup.employee_count) },
              { icon: Calendar,   label: "Founded",      value: startup.founded_year ? String(startup.founded_year) : "—" },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-[#091422] rounded-[14px] p-4 flex flex-col gap-2 border border-[#1a2a3f]">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{label}</span>
                </div>
                <span className="text-sm font-bold text-white">{value}</span>
              </div>
            ))}
          </div>

          {/* Founders */}
          {startup.founders && startup.founders.length > 0 && (
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <UserRound className="w-4 h-4 text-slate-500" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Founder{startup.founders.length > 1 ? "s" : ""}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {startup.founders.map((f, i) => (
                  <span key={i} className="flex items-center gap-1.5 bg-[#091422] border border-[#1a2a3f] text-sm font-medium text-slate-200 px-3 py-1.5 rounded-full">
                    <div className="w-5 h-5 rounded-full bg-amber-900/60 flex items-center justify-center text-[10px] font-black text-amber-400">
                      {f[0].toUpperCase()}
                    </div>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Funding chart */}
          {sortedRounds.length > 0 && <FundingChart rounds={sortedRounds} />}

          {/* Funding rounds list */}
          {sortedRounds.length > 0 && (
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-slate-500" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Funding Rounds
                </h3>
              </div>
              <div className="flex flex-col gap-2">
                {sortedRounds.map((r, idx) => (
                  <div key={r.id ?? idx} className="flex items-center justify-between gap-4 bg-[#091422] border border-[#1a2a3f] rounded-[14px] p-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-none"
                        style={{ backgroundColor: ROUND_HEX[r.round_type ?? "Other"] ?? "#9CA3AF" }}
                      />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.round_type && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROUND_STYLE[r.round_type] ?? ROUND_STYLE["Other"]}`}>
                              {r.round_type}
                            </span>
                          )}
                          {r.announcement_date && (
                            <span className="text-xs text-slate-500">
                              {new Date(r.announcement_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-3 mt-0.5">
                          {r.amount_raised && (
                            <span className="text-xs text-slate-400">
                              <span className="font-bold text-white">{fmt(r.amount_raised)}</span> raised
                            </span>
                          )}
                          {r.valuation && (
                            <span className="text-xs text-slate-400">
                              <span className="font-bold text-white">{fmt(r.valuation)}</span> valuation
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {r.source_url && (
                      <a
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-[#F59E0B] hover:underline font-medium flex-none"
                      >
                        Source <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Website */}
          {startup.website && (
            <a
              href={startup.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-[#F59E0B] transition-colors"
            >
              <Globe className="w-4 h-4" />
              {startup.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <ExternalLink className="w-3.5 h-3.5 opacity-40" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Grid Card ─────────────────────────────────────────────────────────────────

function StartupCard({
  startup,
  onSelect,
  selected,
  onToggleSelect,
}: {
  startup: Startup;
  onSelect: () => void;
  selected: boolean;
  onToggleSelect: (e: React.MouseEvent) => void;
}) {
  const latestRound = startup.funding_rounds?.[0] ?? null;
  const roundType = latestRound?.round_type ?? null;
  const roundStyle = roundType ? (ROUND_STYLE[roundType] ?? ROUND_STYLE["Other"]) : null;
  const location = [startup.city, startup.country].filter(Boolean).join(", ") || null;

  return (
    <div
      onClick={onSelect}
      className={`relative bg-[#0b1626] rounded-[20px] border shadow-[0_2px_16px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col overflow-hidden cursor-pointer group ${
        selected ? "border-[#F59E0B]" : "border-[#1a2a3f] hover:border-[#243858]"
      }`}
    >
      {/* Selection checkbox — top-right corner */}
      <button
        onClick={onToggleSelect}
        className="absolute top-3 right-3 z-10 p-0.5 rounded text-slate-500 hover:text-[#F59E0B] transition-colors"
        aria-label={selected ? "Deselect" : "Select for comparison"}
      >
        {selected
          ? <CheckSquare className="w-4 h-4 text-[#F59E0B]" />
          : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
        }
      </button>

      {/* Card header */}
      <div className="p-5 pb-4 flex-1">
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base font-black flex-none ${avatarColor(startup.name)}`}>
            {startup.name[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 pr-5">
            <h3 className="text-[15px] font-bold text-white truncate leading-tight group-hover:text-[#F59E0B] transition-colors">
              {startup.name}
            </h3>
            {startup.industry && (
              <span className="text-xs text-slate-400 font-medium">{startup.industry}</span>
            )}
          </div>
          {roundType && roundStyle && (
            <span className={`flex-none text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${roundStyle}`}>
              {roundType}
            </span>
          )}
        </div>

        {startup.description && (
          <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 mb-4">
            {startup.description}
          </p>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-[#091422] rounded-[10px] px-3 py-2">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Valuation</div>
            <div className="text-sm font-bold text-white">{fmt(latestRound?.valuation)}</div>
          </div>
          <div className="bg-[#091422] rounded-[10px] px-3 py-2">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Raised</div>
            <div className="text-sm font-bold text-white">{fmt(latestRound?.amount_raised)}</div>
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 mb-3">
          {location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />{location}
            </span>
          )}
          {startup.employee_count && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />{fmtEmp(startup.employee_count)} emp
            </span>
          )}
          {startup.founded_year && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />{startup.founded_year}
            </span>
          )}
        </div>

        {/* Founders */}
        {startup.founders && startup.founders.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {startup.founders.slice(0, 3).map((f, i) => (
              <span key={i} className="flex items-center gap-1 bg-[#091422] border border-[#1a2a3f] text-[10px] font-semibold text-slate-300 px-2 py-1 rounded-full">
                <div className="w-3.5 h-3.5 rounded-full bg-amber-900/60 flex items-center justify-center text-[8px] font-black text-amber-400">
                  {f[0].toUpperCase()}
                </div>
                {f.split(" ")[0]}
              </span>
            ))}
            {startup.founders.length > 3 && (
              <span className="text-[10px] font-semibold text-slate-500 px-2 py-1">
                +{startup.founders.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {startup.website && (
        <div className="px-5 py-3 border-t border-[#1a2a3f] flex items-center gap-1.5">
          <Globe className="w-3 h-3 text-slate-600" />
          <span className="text-[10px] text-slate-500 truncate">
            {startup.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </span>
        </div>
      )}
    </div>
  );
}

// ── List Row ──────────────────────────────────────────────────────────────────

function StartupListRow({ startup, onSelect }: { startup: Startup; onSelect: () => void }) {
  const latestRound = startup.funding_rounds?.[0] ?? null;
  const roundType = latestRound?.round_type ?? null;
  const roundStyle = roundType ? (ROUND_STYLE[roundType] ?? ROUND_STYLE["Other"]) : null;

  return (
    <tr
      onClick={onSelect}
      className="border-b border-gray-50 hover:bg-amber-50/40 cursor-pointer transition-colors group"
    >
      <td className="py-3.5 px-5">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black flex-none ${avatarColor(startup.name)}`}>
            {startup.name[0].toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-bold text-[#0F172A] group-hover:text-[#F59E0B] transition-colors leading-tight">
              {startup.name}
            </div>
            {startup.industry && (
              <div className="text-[10px] text-gray-400 font-medium">{startup.industry}</div>
            )}
          </div>
        </div>
      </td>
      <td className="py-3.5 px-4">
        {roundType && roundStyle ? (
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${roundStyle}`}>
            {roundType}
          </span>
        ) : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="py-3.5 px-4 text-xs text-gray-500">
        {[startup.city, startup.country].filter(Boolean).join(", ") || "—"}
      </td>
      <td className="py-3.5 px-4 text-sm font-bold text-[#0F172A]">{fmt(latestRound?.valuation)}</td>
      <td className="py-3.5 px-4 text-sm font-bold text-[#0F172A]">{fmt(latestRound?.amount_raised)}</td>
      <td className="py-3.5 px-4 text-xs text-gray-500">{fmtEmp(startup.employee_count)}</td>
      <td className="py-3.5 px-4">
        {startup.founders && startup.founders.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {startup.founders.slice(0, 2).map((f, i) => (
              <span key={i} className="text-[10px] bg-gray-50 border border-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                {f.split(" ")[0]}
              </span>
            ))}
            {startup.founders.length > 2 && (
              <span className="text-[10px] text-gray-400">+{startup.founders.length - 2}</span>
            )}
          </div>
        ) : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="py-3.5 px-4 text-right text-gray-300 group-hover:text-[#F59E0B] transition-colors text-sm">→</td>
    </tr>
  );
}

// ── Filter Select ─────────────────────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none pl-3 pr-8 py-2 text-xs font-semibold border rounded-[10px] bg-white transition-all focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/20 cursor-pointer ${
          value ? "border-[#F59E0B] text-[#0F172A]" : "border-gray-200 text-gray-500"
        }`}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
    </div>
  );
}

// ── Add Dialog ────────────────────────────────────────────────────────────────

function AddStartupDialog({
  open, onClose, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (s: Startup) => void;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [progressIdx, setProgressIdx] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setName(""); setStatus("idle"); setErrorMsg(""); setProgressIdx(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  useEffect(() => {
    if (status === "loading") {
      progressTimer.current = setInterval(() => setProgressIdx((i) => Math.min(i + 1, PROGRESS_MESSAGES.length - 1)), 3500);
    } else {
      if (progressTimer.current) clearInterval(progressTimer.current);
    }
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [status]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setStatus("loading"); setProgressIdx(0); setErrorMsg("");
    try {
      const { startup } = await ingestStartup(name.trim());
      setStatus("success");
      setTimeout(() => { onSuccess(startup); onClose(); }, 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={status !== "loading" ? onClose : undefined} />
      <div className="relative bg-white rounded-[24px] shadow-[0_24px_60px_rgba(0,0,0,0.12)] w-full max-w-md p-8 border border-gray-100">
        <button onClick={onClose} disabled={status === "loading"} className="absolute top-5 right-5 text-gray-300 hover:text-gray-600 transition-colors disabled:opacity-30">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center">
            <Rocket className="w-5 h-5 text-[#F59E0B]" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Add a Startup</h2>
            <p className="text-xs text-gray-400">The agent researches and validates it automatically</p>
          </div>
        </div>
        {status === "success" ? (
          <div className="flex flex-col items-center py-4 gap-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="text-sm font-semibold text-[#0F172A]">Added successfully!</p>
          </div>
        ) : status === "loading" ? (
          <div className="flex flex-col items-center py-6 gap-4 text-center">
            <Loader2 className="w-8 h-8 text-[#F59E0B] animate-spin" />
            <div>
              <p className="text-sm font-semibold text-[#0F172A] mb-1">Researching "{name}"</p>
              <p className="text-xs text-gray-400">{PROGRESS_MESSAGES[progressIdx]}</p>
            </div>
            <div className="flex gap-1 mt-2">
              {PROGRESS_MESSAGES.map((_, i) => (
                <div key={i} className={`h-1 w-6 rounded-full transition-all duration-500 ${i <= progressIdx ? "bg-[#F59E0B]" : "bg-gray-100"}`} />
              ))}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {status === "error" && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 flex-none mt-0.5" /><span>{errorMsg}</span>
              </div>
            )}
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Company name</label>
            <input
              ref={inputRef} type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Stripe, Wiz, Deel…"
              className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm text-[#0F172A] placeholder-gray-300 focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/10 transition-all"
            />
            <p className="text-[11px] text-gray-400 mt-2 mb-5">The agent searches the web, validates the data, and saves — takes ~15 seconds.</p>
            <button type="submit" disabled={!name.trim()} className="w-full rounded-[12px] bg-[#0F172A] hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-300 text-white font-semibold text-sm py-3 transition-all duration-200">
              Research & Add
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Startups() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [startups, setStartups] = useState<Startup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [roundFilter, setRoundFilter] = useState<RoundType | "All">("All");
  const [industryFilter, setIndustryFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [empFilter, setEmpFilter] = useState<EmpBucket>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedStartup, setSelectedStartup] = useState<Startup | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const cityParam = searchParams.get("city") ?? "";
  const [cityFilter, setCityFilter] = useState(cityParam);

  useEffect(() => {
    fetchStartups()
      .then(setStartups)
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function clearCityFilter() {
    setCityFilter("");
    setSearchParams((p) => { p.delete("city"); return p; });
  }

  const industries = useMemo(
    () => [...new Set(startups.map((s) => s.industry).filter(Boolean) as string[])].sort(),
    [startups],
  );
  const countries = useMemo(
    () => [...new Set(startups.map((s) => s.country).filter(Boolean) as string[])].sort(),
    [startups],
  );
  const roundCounts = useMemo(
    () => ALL_ROUND_TYPES.map((rt) => ({
      rt,
      count: startups.filter((s) => s.funding_rounds?.[0]?.round_type === rt).length,
    })).filter((r) => r.count > 0),
    [startups],
  );

  const activeFilterCount = [
    industryFilter, countryFilter, empFilter !== "all" ? "1" : "",
    cityFilter, roundFilter !== "All" ? "1" : "", search,
  ].filter(Boolean).length;

  const filtered = useMemo(() => startups.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !s.name.toLowerCase().includes(q) &&
        !(s.industry ?? "").toLowerCase().includes(q) &&
        !(s.country ?? "").toLowerCase().includes(q) &&
        !(s.city ?? "").toLowerCase().includes(q) &&
        !(s.description ?? "").toLowerCase().includes(q)
      ) return false;
    }
    if (industryFilter && s.industry !== industryFilter) return false;
    if (countryFilter && s.country !== countryFilter) return false;
    if (cityFilter && !(s.city ?? "").toLowerCase().includes(cityFilter.toLowerCase()) &&
        !(s.country ?? "").toLowerCase().includes(cityFilter.toLowerCase())) return false;
    if (roundFilter !== "All" && s.funding_rounds?.[0]?.round_type !== roundFilter) return false;
    if (empFilter !== "all") {
      const n = s.employee_count ?? 0;
      if (empFilter === "<50" && n >= 50) return false;
      if (empFilter === "50-200" && (n < 50 || n >= 200)) return false;
      if (empFilter === "200-1k" && (n < 200 || n >= 1000)) return false;
      if (empFilter === "1k+" && n < 1000) return false;
    }
    return true;
  }), [startups, search, industryFilter, countryFilter, cityFilter, roundFilter, empFilter]);

  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">

            {/* Page header */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] flex items-center gap-3">
                  Startups
                  {cityFilter && (
                    <span className="text-lg font-medium text-[#F59E0B]">in {cityFilter}</span>
                  )}
                  {!loading && (
                    <span className="text-sm font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
                      {filtered.length}
                    </span>
                  )}
                </h1>
                <p className="mt-1 text-sm font-medium text-gray-500">
                  AI-researched private companies with funding intelligence.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-white border border-gray-200 rounded-[12px] p-1">
                  <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded-[8px] transition-all ${viewMode === "grid" ? "bg-[#0F172A] text-white" : "text-gray-400 hover:text-gray-700"}`}>
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button onClick={() => setViewMode("list")} className={`p-1.5 rounded-[8px] transition-all ${viewMode === "list" ? "bg-[#0F172A] text-white" : "text-gray-400 hover:text-gray-700"}`}>
                    <List className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-2 rounded-[14px] bg-[#F59E0B] px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_14px_rgba(245,158,11,0.3)] hover:bg-amber-600 transition-all"
                >
                  <Plus className="w-4 h-4" />Add Startup
                </button>
              </div>
            </div>

            {/* Search + filter bar */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                <input
                  type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search companies, industry, location…"
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-[12px] focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/10 transition-all"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Industry */}
              <FilterSelect
                label="All Industries"
                value={industryFilter}
                options={industries}
                onChange={setIndustryFilter}
              />

              {/* Country */}
              <FilterSelect
                label="All Countries"
                value={countryFilter}
                options={countries}
                onChange={setCountryFilter}
              />

              {/* Employee size buttons */}
              <div className="flex bg-white border border-gray-200 rounded-[10px] p-0.5 gap-0.5">
                {EMP_BUCKETS.map((b) => (
                  <button
                    key={b.value}
                    onClick={() => setEmpFilter(b.value)}
                    className={`px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold transition-all whitespace-nowrap ${
                      empFilter === b.value
                        ? "bg-[#0F172A] text-white"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {/* Clear all */}
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setSearch(""); setIndustryFilter(""); setCountryFilter(""); setEmpFilter("all"); setRoundFilter("All"); clearCityFilter(); }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-rose-500 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Clear all ({activeFilterCount})
                </button>
              )}
            </div>

            {/* City + round-type chips */}
            {(cityFilter || roundCounts.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 mb-6">
                {cityFilter && (
                  <button onClick={clearCityFilter} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-[#F59E0B] text-white hover:bg-amber-600 transition-all">
                    <MapPin className="w-3 h-3" />{cityFilter}<X className="w-3 h-3 ml-0.5" />
                  </button>
                )}
                {roundCounts.length > 0 && (
                  <>
                    <button onClick={() => setRoundFilter("All")} className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${roundFilter === "All" ? "bg-[#0F172A] text-white border-[#0F172A]" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"}`}>
                      All ({startups.length})
                    </button>
                    {roundCounts.map(({ rt, count }) => (
                      <button
                        key={rt}
                        onClick={() => setRoundFilter(roundFilter === rt ? "All" : rt)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${roundFilter === rt ? "bg-[#0F172A] text-white border-[#0F172A]" : `${ROUND_STYLE[rt]} hover:opacity-80`}`}
                      >
                        {rt} ({count})
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Content */}
            {loading ? (
              <div className="flex items-center justify-center py-32">
                <Loader2 className="w-6 h-6 text-[#F59E0B] animate-spin" />
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center py-24 gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm font-semibold text-[#0F172A]">Failed to load startups</p>
                <p className="text-xs text-gray-400 max-w-xs">{loadError}</p>
              </div>
            ) : startups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 text-center">
                <div className="w-16 h-16 rounded-3xl bg-amber-50 flex items-center justify-center mb-6">
                  <Rocket className="w-7 h-7 text-[#F59E0B]" />
                </div>
                <h2 className="text-xl font-bold text-[#0F172A] mb-3">No startups yet</h2>
                <p className="text-sm text-gray-400 max-w-sm leading-relaxed mb-8">
                  Add your first startup — the AI agent will research, validate, and store it with full funding history.
                </p>
                <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-[16px] bg-[#F59E0B] px-6 py-3 text-sm font-bold text-white shadow-[0_4px_14px_rgba(245,158,11,0.3)] hover:bg-amber-600 transition-all">
                  <Plus className="w-4 h-4" />Add First Startup
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center py-20 gap-3 text-center">
                <Building2 className="w-8 h-8 text-gray-300" />
                <p className="text-sm font-semibold text-gray-400">No companies match these filters</p>
                <button
                  onClick={() => { setSearch(""); setIndustryFilter(""); setCountryFilter(""); setEmpFilter("all"); setRoundFilter("All"); clearCityFilter(); }}
                  className="text-xs text-[#F59E0B] font-semibold hover:underline"
                >Clear all filters</button>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {filtered.map((s) => (
                  <StartupCard
                    key={s.id}
                    startup={s}
                    onSelect={() => setSelectedStartup(s)}
                    selected={selectedIds.has(s.id)}
                    onToggleSelect={(e) => toggleSelect(s.id, e)}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-[20px] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100 bg-[#F8FAFC]">
                        {["Company", "Stage", "Location", "Valuation", "Raised", "Employees", "Founders", ""].map((h) => (
                          <th key={h} className="text-left text-[9px] font-black text-gray-400 uppercase tracking-widest py-3 px-4 first:px-5 whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((s) => (
                        <StartupListRow key={s.id} startup={s} onSelect={() => setSelectedStartup(s)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>

      <AddStartupDialog open={showAdd} onClose={() => setShowAdd(false)} onSuccess={(s) => setStartups((p) => [s, ...p])} />

      {selectedStartup && (
        <StartupDetailModal startup={selectedStartup} onClose={() => setSelectedStartup(null)} />
      )}
    </Layout>
  );
}
