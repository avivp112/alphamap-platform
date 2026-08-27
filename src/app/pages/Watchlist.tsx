import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  Search, Plus, X, Check, Square, CheckSquare, Eye, Building2, Landmark,
  MapPin, Calendar, Users, Loader2, AlertCircle, GitCompare,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { CompanyLogo } from "../components/CompanyLogo";
import {
  fetchStartupsPage, fetchInvestors,
  type StartupListRow, type InvestorRow,
} from "../../lib/supabase";
import {
  fetchWatchlist, addToWatchlist, removeFromWatchlist,
  type WatchlistEntityType, type WatchlistData,
} from "../../lib/watchlist";
import { useUserPlan } from "../../lib/plan";

// ─────────────────────────────────────────────────────────────────────────────
// My Watchlist — track specific companies and funds. Search to find and add
// new ones; every card (tracked or a search result) has a small checkbox on
// the left for multi-select-to-compare. Clicking the card body itself (not
// the checkbox) focuses it, swapping that same spot to a direct Add/Remove
// action for just that one item.
// ─────────────────────────────────────────────────────────────────────────────

function key(type: WatchlistEntityType, id: string): string {
  return `${type}:${id}`;
}

function fmtUsd(v: number | null | undefined): string {
  if (!v) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}
function fmtEmp(n: number | null | undefined): string {
  if (!n) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
const FIRM_TYPE_LABEL: Record<string, string> = { vc: "VC", pe: "Private Equity", growth: "Growth" };

interface CardItem {
  type: WatchlistEntityType;
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  chips: string[];
  raw: StartupListRow | InvestorRow;
}

function toCardItem(type: "startup", row: StartupListRow): CardItem;
function toCardItem(type: "investor", row: InvestorRow): CardItem;
function toCardItem(type: WatchlistEntityType, row: StartupListRow | InvestorRow): CardItem {
  if (type === "startup") {
    const s = row as StartupListRow;
    const loc = [s.city, s.country].filter(Boolean).join(", ");
    return {
      type, id: s.id, name: s.name, website: s.website, description: s.description,
      chips: [s.industry, loc, s.founded_year ? `Est. ${s.founded_year}` : null].filter(Boolean) as string[],
      raw: s,
    };
  }
  const i = row as InvestorRow;
  return {
    type, id: i.id, name: i.name, website: i.website, description: i.description,
    chips: [
      i.firm_type ? FIRM_TYPE_LABEL[i.firm_type] ?? i.firm_type.toUpperCase() : null,
      i.headquarters, i.fund_size,
    ].filter(Boolean) as string[],
    raw: i,
  };
}

export function Watchlist() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loggedIn, loading: authLoading } = useUserPlan();

  const [watchlist, setWatchlist] = useState<WatchlistData>({ startups: [], investors: [] });
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<{ startups: StartupListRow[]; investors: InvestorRow[] }>({ startups: [], investors: [] });
  const [allInvestors, setAllInvestors] = useState<InvestorRow[] | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set()); // in-flight add/remove
  const [compareOpen, setCompareOpen] = useState(false);

  const trackedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const st of watchlist.startups)  s.add(key("startup", st.id));
    for (const iv of watchlist.investors) s.add(key("investor", iv.id));
    return s;
  }, [watchlist]);

  function loadWatchlist() {
    setLoadingList(true);
    setListError(null);
    fetchWatchlist()
      .then(setWatchlist)
      .catch((e) => setListError(e instanceof Error ? e.message : "Failed to load your watchlist."))
      .finally(() => setLoadingList(false));
  }

  useEffect(() => {
    if (!authLoading && loggedIn) loadWatchlist();
    else if (!authLoading) setLoadingList(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, loggedIn]);

  async function runSearch(q: string) {
    const term = q.trim();
    if (!term) { setResults({ startups: [], investors: [] }); setSearched(false); return; }
    setSearching(true);
    setSearched(true);
    try {
      const [startupRows, investors] = await Promise.all([
        fetchStartupsPage({ search: term }, 1),
        allInvestors ? Promise.resolve(allInvestors) : fetchInvestors().then((rows) => { setAllInvestors(rows); return rows; }),
      ]);
      const lower = term.toLowerCase();
      const investorMatches = investors.filter((i) =>
        i.name.toLowerCase().includes(lower) ||
        i.headquarters?.toLowerCase().includes(lower) ||
        i.description?.toLowerCase().includes(lower)
      );
      setResults({ startups: startupRows.slice(0, 12), investors: investorMatches.slice(0, 12) });
    } catch {
      setResults({ startups: [], investors: [] });
    } finally {
      setSearching(false);
    }
  }

  function toggleSelect(k: string) {
    setFocused(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function toggleFocus(k: string) {
    if (selected.has(k)) return; // checkbox takes precedence
    setFocused((prev) => (prev === k ? null : k));
  }

  async function handleAdd(type: WatchlistEntityType, id: string) {
    const k = key(type, id);
    setPending((p) => new Set(p).add(k));
    try {
      await addToWatchlist(type, id);
      loadWatchlist();
      setFocused(null);
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(k); return n; });
    }
  }

  async function handleRemove(type: WatchlistEntityType, id: string) {
    const k = key(type, id);
    setPending((p) => new Set(p).add(k));
    try {
      await removeFromWatchlist(type, id);
      setSelected((s) => { const n = new Set(s); n.delete(k); return n; });
      loadWatchlist();
      setFocused(null);
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(k); return n; });
    }
  }

  // Selected items, resolved back to full records, split by type.
  const selectedItems = useMemo(() => {
    const pool: CardItem[] = [
      ...watchlist.startups.map((s) => toCardItem("startup", s)),
      ...watchlist.investors.map((i) => toCardItem("investor", i)),
      ...results.startups.map((s) => toCardItem("startup", s)),
      ...results.investors.map((i) => toCardItem("investor", i)),
    ];
    const seen = new Set<string>();
    const dedup = pool.filter((c) => {
      const k = key(c.type, c.id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return dedup.filter((c) => selected.has(key(c.type, c.id)));
  }, [watchlist, results, selected]);

  const selectedStartups  = selectedItems.filter((c) => c.type === "startup");
  const selectedInvestors = selectedItems.filter((c) => c.type === "investor");
  const canCompare = (selectedStartups.length >= 2 && selectedInvestors.length === 0)
                  || (selectedInvestors.length >= 2 && selectedStartups.length === 0);

  if (!authLoading && !loggedIn) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-24 text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center mb-5">
            <Eye className="w-6 h-6 text-gray-400" />
          </div>
          <h1 className="text-xl font-bold text-[#0F172A]">{t("watchlist.signInTitle")}</h1>
          <p className="mt-2 text-sm text-gray-500">{t("watchlist.signInBlurb")}</p>
          <button
            onClick={() => navigate("/login?next=" + encodeURIComponent("/watchlist"))}
            className="mt-6 rounded-[8px] bg-[#0F172A] px-5 py-2.5 text-sm font-bold text-white hover:bg-gray-900 transition-colors"
          >{t("header.logIn")}</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={`mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-8 sm:py-12 ${selected.size > 0 ? "pb-28" : ""}`}>
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">{t("watchlist.title")}</h1>
          <p className="mt-1 sm:mt-2 text-sm font-medium text-gray-500">{t("watchlist.trackBlurb")}</p>
        </div>

        {/* ── Search to add ── */}
        <div className="mb-10">
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
            className="relative max-w-xl"
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("watchlist.searchPlaceholder")}
              className="w-full pl-11 pr-24 py-3 text-sm bg-white border border-gray-200 rounded-[8px] text-[#0F172A] placeholder-gray-400 focus:outline-none focus:border-gray-300 focus:ring-2 focus:ring-[#0F172A]/10 transition-all"
            />
            <button
              type="submit"
              disabled={!query.trim() || searching}
              className="absolute right-1.5 top-1.5 bottom-1.5 flex items-center gap-1.5 rounded-[10px] bg-[#0F172A] px-4 text-xs font-bold text-white hover:bg-gray-900 disabled:opacity-50 transition-colors"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
            </button>
          </form>

          {searched && (
            <div className="mt-5">
              {searching ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-6">
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching…
                </div>
              ) : results.startups.length === 0 && results.investors.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">No companies or funds matched “{query}”.</p>
              ) : (
                <div className="space-y-6">
                  {results.startups.length > 0 && (
                    <CardGroup
                      icon={Building2} title="Companies" items={results.startups.map((s) => toCardItem("startup", s))}
                      trackedKeys={trackedKeys} selected={selected} focused={focused} pending={pending}
                      onToggleSelect={toggleSelect} onToggleFocus={toggleFocus} onAdd={handleAdd} onRemove={handleRemove}
                    />
                  )}
                  {results.investors.length > 0 && (
                    <CardGroup
                      icon={Landmark} title="Investors" items={results.investors.map((i) => toCardItem("investor", i))}
                      trackedKeys={trackedKeys} selected={selected} focused={focused} pending={pending}
                      onToggleSelect={toggleSelect} onToggleFocus={toggleFocus} onAdd={handleAdd} onRemove={handleRemove}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Tracked items ── */}
        <div className="border-t border-gray-100 pt-8">
          {loadingList ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-10">
              <Loader2 className="w-4 h-4 animate-spin" />{t("watchlist.loading")}</div>
          ) : listError ? (
            <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200/60 rounded-[8px] px-4 py-3.5">
              <AlertCircle className="w-4 h-4 text-rose-500 flex-none mt-0.5" />
              <p className="text-xs text-rose-700 leading-relaxed">{listError}</p>
            </div>
          ) : watchlist.startups.length === 0 && watchlist.investors.length === 0 ? (
            <div className="flex flex-col items-center text-center py-16 px-6 rounded-[10px] border border-dashed border-gray-200">
              <Eye className="w-8 h-8 text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-[#0F172A]">{t("watchlist.nothingTracked")}</p>
              <p className="mt-1 text-xs text-gray-400 max-w-xs">
                Search above to find a company or fund, then click it and hit “Add to Watchlist.”
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {watchlist.startups.length > 0 && (
                <CardGroup
                  icon={Building2} title="Companies" items={watchlist.startups.map((s) => toCardItem("startup", s))}
                  trackedKeys={trackedKeys} selected={selected} focused={focused} pending={pending}
                  onToggleSelect={toggleSelect} onToggleFocus={toggleFocus} onAdd={handleAdd} onRemove={handleRemove}
                />
              )}
              {watchlist.investors.length > 0 && (
                <CardGroup
                  icon={Landmark} title="Investors" items={watchlist.investors.map((i) => toCardItem("investor", i))}
                  trackedKeys={trackedKeys} selected={selected} focused={focused} pending={pending}
                  onToggleSelect={toggleSelect} onToggleFocus={toggleFocus} onAdd={handleAdd} onRemove={handleRemove}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Sticky compare bar ── */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm shadow-[0_-8px_30px_rgba(15,23,42,0.06)]">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-[#0F172A]">{selected.size} selected</span>
              {!canCompare && (
                <span className="text-xs text-gray-400">{t("watchlist.compareHint")}</span>
              )}
              <button onClick={() => setSelected(new Set())} className="text-xs font-semibold text-gray-400 hover:text-rose-600 transition-colors">{t("common.clear")}</button>
            </div>
            <button
              onClick={() => setCompareOpen(true)}
              disabled={!canCompare}
              className="flex items-center gap-1.5 rounded-[8px] bg-[#0F172A] px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <GitCompare className="w-4 h-4" />{t("common.compare")}</button>
          </div>
        </div>
      )}

      {compareOpen && (
        <CompareModal
          items={selectedStartups.length ? selectedStartups : selectedInvestors}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </Layout>
  );
}

// ── Card group ────────────────────────────────────────────────────────────────
function CardGroup({
  icon: Icon, title, items, trackedKeys, selected, focused, pending,
  onToggleSelect, onToggleFocus, onAdd, onRemove,
}: {
  icon: React.ElementType; title: string; items: CardItem[];
  trackedKeys: Set<string>; selected: Set<string>; focused: string | null; pending: Set<string>;
  onToggleSelect: (k: string) => void; onToggleFocus: (k: string) => void;
  onAdd: (type: WatchlistEntityType, id: string) => void; onRemove: (type: WatchlistEntityType, id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-[#0F172A]/50" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">{title}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => {
          const k = key(item.type, item.id);
          return (
            <TrackableCard
              key={k}
              item={item}
              tracked={trackedKeys.has(k)}
              selected={selected.has(k)}
              focused={focused === k}
              isPending={pending.has(k)}
              onToggleSelect={() => onToggleSelect(k)}
              onToggleFocus={() => onToggleFocus(k)}
              onAdd={() => onAdd(item.type, item.id)}
              onRemove={() => onRemove(item.type, item.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
function TrackableCard({
  item, tracked, selected, focused, isPending, onToggleSelect, onToggleFocus, onAdd, onRemove,
}: {
  item: CardItem; tracked: boolean; selected: boolean; focused: boolean; isPending: boolean;
  onToggleSelect: () => void; onToggleFocus: () => void; onAdd: () => void; onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onToggleFocus}
      className={`group relative flex gap-3 rounded-[8px] border bg-white p-4 cursor-pointer transition-all ${
        selected ? "border-[#0F172A] shadow-[0_4px_16px_rgba(15,23,42,0.08)]" : "border-gray-100 hover:border-gray-300 hover:shadow-[0_4px_16px_rgba(15,23,42,0.05)]"
      }`}
    >
      {/* Left spot: checkbox <-> add/remove, mutually exclusive */}
      <button
        onClick={(e) => { e.stopPropagation(); if (isPending) return; if (focused && !selected) { tracked ? onRemove() : onAdd(); } else { onToggleSelect(); } }}
        disabled={isPending}
        className="flex-none mt-0.5"
        aria-label={selected ? "Deselect" : focused ? (tracked ? "Remove from watchlist" : "Add to watchlist") : "Select for comparison"}
      >
        {isPending ? (
          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
        ) : selected ? (
          <CheckSquare className="w-4 h-4 text-[#0F172A]" />
        ) : focused ? (
          tracked ? (
            <span className="flex items-center justify-center w-5 h-5 rounded-md bg-rose-50 border border-rose-200 text-rose-600">
              <X className="w-3 h-3" />
            </span>
          ) : (
            <span className="flex items-center justify-center w-5 h-5 rounded-md bg-[#0F172A] text-white">
              <Plus className="w-3 h-3" />
            </span>
          )
        ) : (
          <Square className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 mb-1.5">
          <CompanyLogo name={item.name} website={item.website} size={30} rounded="rounded-[9px]" />
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-[#0F172A] truncate">{item.name}</h4>
          </div>
          {tracked && !focused && (
            <Check className="w-3.5 h-3.5 text-[#7C8967] flex-none ml-auto" />
          )}
        </div>
        {item.description && (
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-2">{item.description}</p>
        )}
        {item.chips.length > 0 && (
          <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] font-medium text-gray-400">
            {item.chips.map((c, i) => <span key={i}>{c}</span>)}
          </div>
        )}
        {focused && (
          <button
            onClick={(e) => { e.stopPropagation(); if (!isPending) (tracked ? onRemove() : onAdd()); }}
            disabled={isPending}
            className={`mt-3 w-full flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-bold transition-colors ${
              tracked ? "bg-rose-50 text-rose-600 hover:bg-rose-100" : "bg-[#0F172A] text-white hover:bg-gray-900"
            }`}
          >
            {tracked ? <><X className="w-3.5 h-3.5" />{t("watchlist.removeFrom")}</> : <><Plus className="w-3.5 h-3.5" />{t("watchlist.addTo")}</>}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Compare modal ─────────────────────────────────────────────────────────────
function CompareModal({ items, onClose }: { items: CardItem[]; onClose: () => void }) {
  const { t } = useTranslation();
  const type = items[0]?.type;
  const rows: { label: string; icon: React.ElementType; value: (item: CardItem) => string }[] = type === "startup"
    ? [
        { label: "Industry",   icon: Building2, value: (it) => (it.raw as StartupListRow).industry ?? "—" },
        { label: "Location",   icon: MapPin,    value: (it) => [(it.raw as StartupListRow).city, (it.raw as StartupListRow).country].filter(Boolean).join(", ") || "—" },
        { label: "Founded",    icon: Calendar,  value: (it) => (it.raw as StartupListRow).founded_year ? String((it.raw as StartupListRow).founded_year) : "—" },
        { label: "Employees",  icon: Users,     value: (it) => fmtEmp((it.raw as StartupListRow).employee_count) },
        { label: "Valuation",  icon: Landmark,  value: (it) => fmtUsd((it.raw as StartupListRow).latest_valuation) },
        { label: "Total Raised", icon: Landmark, value: (it) => fmtUsd((it.raw as StartupListRow).total_raised) },
      ]
    : [
        { label: "Type",         icon: Landmark, value: (it) => { const ft = (it.raw as InvestorRow).firm_type; return ft ? (FIRM_TYPE_LABEL[ft] ?? ft.toUpperCase()) : "—"; } },
        { label: "Headquarters", icon: MapPin,   value: (it) => (it.raw as InvestorRow).headquarters ?? "—" },
        { label: "Fund Size",    icon: Landmark, value: (it) => (it.raw as InvestorRow).fund_size ?? "—" },
        { label: "Founded",      icon: Calendar, value: (it) => (it.raw as InvestorRow).founded_year ? String((it.raw as InvestorRow).founded_year) : "—" },
      ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(6,13,25,0.55)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden bg-white rounded-[10px] shadow-[0_32px_80px_rgba(15,23,42,0.35)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-none flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-[#0F172A]">Compare {type === "startup" ? "Companies" : "Investors"}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-[#0F172A] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 pb-3 pr-4 w-32">{t("common.metric")}</th>
                  {items.map((it) => (
                    <th key={key(it.type, it.id)} className="text-left pb-3 px-4 min-w-[160px]">
                      <div className="flex items-center gap-2">
                        <CompanyLogo name={it.name} website={it.website} size={26} rounded="rounded-[8px]" />
                        <span className="text-sm font-bold text-[#0F172A] truncate">{it.name}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-gray-100">
                    <td className="py-3 pr-4 text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                      <row.icon className="w-3.5 h-3.5 text-gray-300" />{row.label}
                    </td>
                    {items.map((it) => (
                      <td key={key(it.type, it.id)} className="py-3 px-4 text-sm font-bold text-[#0F172A]">{row.value(it)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
