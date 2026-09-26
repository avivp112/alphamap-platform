import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import {
  Search, Plus, X, Check, Square, CheckSquare, Eye, Building2, Landmark,
  MapPin, Calendar, Users, Loader2, AlertCircle, GitCompare, Sparkles, Bell,
  CheckCheck, Radar, Star,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { CompanyLogo } from "../components/CompanyLogo";
import {
  fetchStartupsPage, fetchInvestors, fetchStartupsByIds, fetchTopThesisMatches,
  fetchPreferenceSignalCount, fetchNotifications, markNotificationRead, markAllNotificationsRead,
  type StartupListRow, type InvestorRow, type ThesisMatch, type Notification,
} from "../../lib/supabase";
import {
  fetchWatchlist, addToWatchlist, removeFromWatchlist, updateWatchlistItem, watchlistErrorMessage,
  type WatchlistEntityType, type WatchlistData, type WithWatchlistMeta,
} from "../../lib/watchlist";
import { useUserPlan } from "../../lib/plan";

// ─────────────────────────────────────────────────────────────────────────────
// My Area — the personal hub. Watchlist_items/user_mandates/
// user_preference_vectors already existed as separate pieces of
// infrastructure (Behavioral Preference Engine, Phases 1-5); this page is
// where a signed-in user actually SEES them working together, split into
// three tabs:
//   1. Curated Watchlist  — companies/funds the user explicitly bookmarked.
//      Was the entire old /watchlist page; unchanged behavior, now also
//      supports personal notes + tags per entry.
//   2. Thesis Matches     — the questionnaire (user_mandates) + the derived
//      preference vector now take effect HERE, not on the Private Market
//      page (which is unfiltered global discovery — see Startups.tsx).
//   3. Live Alerts        — the existing notification bell's data, surfaced
//      as a feed rather than only a dropdown. Today this only ever shows the
//      one-time welcome notification (20260930000000) — the alert-matching
//      job that would populate real watchlist/match alerts is separate,
//      later infrastructure, not built as part of this page.
// ─────────────────────────────────────────────────────────────────────────────

type TabId = "watchlist" | "matches" | "alerts";
const TABS: { id: TabId; icon: React.ElementType }[] = [
  { id: "watchlist", icon: Star },
  { id: "matches", icon: Sparkles },
  { id: "alerts", icon: Bell },
];

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
// Minute/hour granularity, same as TopNav's own notification dropdown — a
// feed's freshest items are often minutes old.
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const FIRM_TYPE_LABEL: Record<string, string> = { vc: "VC", pe: "Private Equity", growth: "Growth" };

export function MyArea() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { loggedIn, loading: authLoading } = useUserPlan();

  const tabParam = searchParams.get("tab");
  const activeTab: TabId = (tabParam === "matches" || tabParam === "alerts") ? tabParam : "watchlist";
  function setActiveTab(tab: TabId) {
    setSearchParams((p) => { if (tab === "watchlist") p.delete("tab"); else p.set("tab", tab); return p; });
  }

  if (!authLoading && !loggedIn) {
    return <SignInGate />;
  }

  return (
    <Layout>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="mb-6">
          <div className="flex items-center gap-2.5">
            <Radar className="w-6 h-6 text-[#0F172A]" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">{t("myArea.title")}</h1>
          </div>
          <p className="mt-1 sm:mt-2 text-sm font-medium text-gray-500">{t("myArea.subtitle")}</p>
        </div>

        <div className="flex items-center gap-1 border-b border-gray-100 mb-8 -mx-1 overflow-x-auto">
          {TABS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                activeTab === id ? "border-[#0F172A] text-[#0F172A]" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t(`myArea.tabs.${id}`)}
            </button>
          ))}
        </div>

        {activeTab === "watchlist" && <CuratedWatchlistTab />}
        {activeTab === "matches" && <ThesisMatchesTab />}
        {activeTab === "alerts" && <LiveAlertsTab />}
      </div>
    </Layout>
  );
}

function SignInGate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Layout>
      <div className="mx-auto max-w-md px-4 py-24 text-center flex flex-col items-center">
        <div className="w-14 h-14 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center mb-5">
          <Radar className="w-6 h-6 text-gray-400" />
        </div>
        <h1 className="text-xl font-bold text-[#0F172A]">{t("myArea.signInTitle")}</h1>
        <p className="mt-2 text-sm text-gray-500">{t("myArea.signInBlurb")}</p>
        <button
          onClick={() => navigate("/login?next=" + encodeURIComponent("/my-area"))}
          className="mt-6 rounded-[8px] bg-[#0F172A] px-5 py-2.5 text-sm font-bold text-white hover:bg-gray-900 transition-colors"
        >{t("header.logIn")}</button>
      </div>
    </Layout>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 1 — Curated Watchlist. Identical to the old standalone /watchlist page,
// plus a per-entry notes/tags editor.
// ═════════════════════════════════════════════════════════════════════════════

interface CardItem {
  type: WatchlistEntityType;
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  chips: string[];
  raw: StartupListRow | InvestorRow;
  notes: string | null;
  tags: string[];
}

function toCardItem(type: "startup", row: StartupListRow | WithWatchlistMeta<StartupListRow>): CardItem;
function toCardItem(type: "investor", row: InvestorRow | WithWatchlistMeta<InvestorRow>): CardItem;
function toCardItem(
  type: WatchlistEntityType,
  row: StartupListRow | InvestorRow | WithWatchlistMeta<StartupListRow> | WithWatchlistMeta<InvestorRow>,
): CardItem {
  const meta = row as Partial<WithWatchlistMeta<unknown>>;
  const notes = meta.watchlistNotes ?? null;
  const tags = meta.watchlistTags ?? [];
  if (type === "startup") {
    const s = row as StartupListRow;
    const loc = [s.city, s.country].filter(Boolean).join(", ");
    return {
      type, id: s.id, name: s.name, website: s.website, description: s.description,
      chips: [s.industry, loc, s.founded_year ? `Est. ${s.founded_year}` : null].filter(Boolean) as string[],
      raw: s, notes, tags,
    };
  }
  const i = row as InvestorRow;
  return {
    type, id: i.id, name: i.name, website: i.website, description: i.description,
    chips: [
      i.firm_type ? FIRM_TYPE_LABEL[i.firm_type] ?? i.firm_type.toUpperCase() : null,
      i.headquarters, i.fund_size,
    ].filter(Boolean) as string[],
    raw: i, notes, tags,
  };
}

function CuratedWatchlistTab() {
  const { t } = useTranslation();

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
  const [pending, setPending] = useState<Set<string>>(new Set());
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
      .catch((e) => setListError(watchlistErrorMessage(e)))
      .finally(() => setLoadingList(false));
  }

  useEffect(() => { loadWatchlist(); }, []);

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
    if (selected.has(k)) return;
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

  return (
    <div className={selected.size > 0 ? "pb-24" : ""}>
      <div className="mb-8">
        <form onSubmit={(e) => { e.preventDefault(); runSearch(query); }} className="relative max-w-xl">
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
              <div className="flex items-center gap-2 text-sm text-gray-400 py-6"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</div>
            ) : results.startups.length === 0 && results.investors.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">No companies or funds matched “{query}”.</p>
            ) : (
              <div className="space-y-6">
                {results.startups.length > 0 && (
                  <CardGroup
                    icon={Building2} title="Companies" items={results.startups.map((s) => toCardItem("startup", s))}
                    trackedKeys={trackedKeys} selected={selected} focused={focused} pending={pending}
                    onToggleSelect={toggleSelect} onToggleFocus={toggleFocus} onAdd={handleAdd} onRemove={handleRemove}
                    onMetaSaved={loadWatchlist}
                  />
                )}
                {results.investors.length > 0 && (
                  <CardGroup
                    icon={Landmark} title="Investors" items={results.investors.map((i) => toCardItem("investor", i))}
                    trackedKeys={trackedKeys} selected={selected} focused={focused} pending={pending}
                    onToggleSelect={toggleSelect} onToggleFocus={toggleFocus} onAdd={handleAdd} onRemove={handleRemove}
                    onMetaSaved={loadWatchlist}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-8">
        {loadingList ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-10"><Loader2 className="w-4 h-4 animate-spin" />{t("watchlist.loading")}</div>
        ) : listError ? (
          <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200/60 rounded-[8px] px-4 py-3.5">
            <AlertCircle className="w-4 h-4 text-rose-500 flex-none mt-0.5" />
            <p className="text-xs text-rose-700 leading-relaxed">{listError}</p>
          </div>
        ) : watchlist.startups.length === 0 && watchlist.investors.length === 0 ? (
          <div className="flex flex-col items-center text-center py-16 px-6 rounded-[10px] border border-dashed border-gray-200">
            <Eye className="w-8 h-8 text-gray-300 mb-3" />
            <p className="text-sm font-semibold text-[#0F172A]">{t("watchlist.nothingTracked")}</p>
            <p className="mt-1 text-xs text-gray-400 max-w-xs">{t("watchlist.nothingTrackedHint")}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {watchlist.startups.length > 0 && (
              <CardGroup
                icon={Building2} title="Companies" items={watchlist.startups.map((s) => toCardItem("startup", s))}
                trackedKeys={trackedKeys} selected={selected} focused={focused} pending={pending}
                onToggleSelect={toggleSelect} onToggleFocus={toggleFocus} onAdd={handleAdd} onRemove={handleRemove}
                onMetaSaved={loadWatchlist}
              />
            )}
            {watchlist.investors.length > 0 && (
              <CardGroup
                icon={Landmark} title="Investors" items={watchlist.investors.map((i) => toCardItem("investor", i))}
                trackedKeys={trackedKeys} selected={selected} focused={focused} pending={pending}
                onToggleSelect={toggleSelect} onToggleFocus={toggleFocus} onAdd={handleAdd} onRemove={handleRemove}
                onMetaSaved={loadWatchlist}
              />
            )}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(15,23,42,0.06)]">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-[#0F172A]">{selected.size} selected</span>
              {!canCompare && <span className="text-xs text-gray-400">{t("watchlist.compareHint")}</span>}
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
        <CompareModal items={selectedStartups.length ? selectedStartups : selectedInvestors} onClose={() => setCompareOpen(false)} />
      )}
    </div>
  );
}

function CardGroup({
  icon: Icon, title, items, trackedKeys, selected, focused, pending,
  onToggleSelect, onToggleFocus, onAdd, onRemove, onMetaSaved,
}: {
  icon: React.ElementType; title: string; items: CardItem[];
  trackedKeys: Set<string>; selected: Set<string>; focused: string | null; pending: Set<string>;
  onToggleSelect: (k: string) => void; onToggleFocus: (k: string) => void;
  onAdd: (type: WatchlistEntityType, id: string) => void; onRemove: (type: WatchlistEntityType, id: string) => void;
  onMetaSaved: () => void;
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
              onMetaSaved={onMetaSaved}
            />
          );
        })}
      </div>
    </div>
  );
}

function TrackableCard({
  item, tracked, selected, focused, isPending, onToggleSelect, onToggleFocus, onAdd, onRemove, onMetaSaved,
}: {
  item: CardItem; tracked: boolean; selected: boolean; focused: boolean; isPending: boolean;
  onToggleSelect: () => void; onToggleFocus: () => void; onAdd: () => void; onRemove: () => void;
  onMetaSaved: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onToggleFocus}
      className={`group relative flex gap-3 rounded-[8px] border bg-white p-4 cursor-pointer transition-all ${
        selected ? "border-[#0F172A] shadow-[0_4px_16px_rgba(15,23,42,0.08)]" : "border-gray-100 hover:border-gray-300 hover:shadow-[0_4px_16px_rgba(15,23,42,0.05)]"
      }`}
    >
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
            <span className="flex items-center justify-center w-5 h-5 rounded-md bg-rose-50 border border-rose-200 text-rose-600"><X className="w-3 h-3" /></span>
          ) : (
            <span className="flex items-center justify-center w-5 h-5 rounded-md bg-[#0F172A] text-white"><Plus className="w-3 h-3" /></span>
          )
        ) : (
          <Square className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 mb-1.5">
          <CompanyLogo name={item.name} website={item.website} size={30} rounded="rounded-[9px]" />
          <div className="min-w-0"><h4 className="text-sm font-bold text-[#0F172A] truncate">{item.name}</h4></div>
          {tracked && !focused && <Check className="w-3.5 h-3.5 text-[#7C8967] flex-none ml-auto" />}
        </div>
        {item.description && <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-2">{item.description}</p>}
        {item.chips.length > 0 && (
          <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] font-medium text-gray-400">
            {item.chips.map((c, i) => <span key={i}>{c}</span>)}
          </div>
        )}
        {!focused && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {item.tags.map((tag) => (
              <span key={tag} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{tag}</span>
            ))}
          </div>
        )}
        {focused && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); if (!isPending) (tracked ? onRemove() : onAdd()); }}
              disabled={isPending}
              className={`mt-3 w-full flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-bold transition-colors ${
                tracked ? "bg-rose-50 text-rose-600 hover:bg-rose-100" : "bg-[#0F172A] text-white hover:bg-gray-900"
              }`}
            >
              {tracked ? <><X className="w-3.5 h-3.5" />{t("watchlist.removeFrom")}</> : <><Plus className="w-3.5 h-3.5" />{t("watchlist.addTo")}</>}
            </button>
            {tracked && (
              <NotesTagsEditor type={item.type} id={item.id} notes={item.notes} tags={item.tags} onSaved={onMetaSaved} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Personal notes + tags for a tracked entry. Only rendered once an item is
// already tracked (see TrackableCard) — annotating a search result that
// hasn't been added yet has no row to attach to.
function NotesTagsEditor({ type, id, notes, tags, onSaved }: {
  type: WatchlistEntityType; id: string; notes: string | null; tags: string[]; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(patch: { notes?: string | null; tags?: string[] }) {
    setSaving(true);
    try {
      await updateWatchlistItem(type, id, patch);
      onSaved();
    } catch {
      /* best-effort; the field simply doesn't persist this round */
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const tag = tagInput.trim();
    setTagInput("");
    if (!tag || tags.includes(tag)) return;
    save({ tags: [...tags, tag] });
  }
  function removeTag(tag: string) {
    save({ tags: tags.filter((tg) => tg !== tag) });
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
            {tag}
            <button onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`} className="text-gray-400 hover:text-rose-600"><X className="w-2.5 h-2.5" /></button>
          </span>
        ))}
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          onBlur={addTag}
          placeholder={t("watchlist.addTag")}
          className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-gray-300 text-gray-500 placeholder-gray-400 focus:outline-none focus:border-gray-400 w-24"
        />
        {saving && <Loader2 className="w-3 h-3 animate-spin text-gray-300" />}
      </div>
      <textarea
        value={draftNotes}
        onChange={(e) => setDraftNotes(e.target.value)}
        onBlur={() => { if (draftNotes !== (notes ?? "")) save({ notes: draftNotes || null }); }}
        placeholder={t("watchlist.notesPlaceholder")}
        rows={2}
        className="w-full text-xs text-gray-600 placeholder-gray-400 border border-gray-200 rounded-[6px] px-2.5 py-1.5 focus:outline-none focus:border-gray-300 resize-none"
      />
    </div>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" style={{ background: "rgba(6,13,25,0.55)", backdropFilter: "blur(8px)" }} onClick={onClose}>
      <div className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden bg-white rounded-[10px] shadow-[0_32px_80px_rgba(15,23,42,0.35)] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex-none flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-[#0F172A]">Compare {type === "startup" ? "Companies" : "Investors"}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-[#0F172A] transition-colors"><X className="w-4 h-4" /></button>
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
                    <td className="py-3 pr-4 text-xs font-semibold text-gray-500 flex items-center gap-1.5"><row.icon className="w-3.5 h-3.5 text-gray-300" />{row.label}</td>
                    {items.map((it) => <td key={key(it.type, it.id)} className="py-3 px-4 text-sm font-bold text-[#0F172A]">{row.value(it)}</td>)}
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

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2 — Thesis Matches & Recommendations. This is where user_mandates +
// user_preference_vectors now take effect — never as a filter on the Private
// Market page.
// ═════════════════════════════════════════════════════════════════════════════

function MatchBadge({ pct }: { pct: number }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-indigo-50 text-indigo-700 border border-indigo-100">
      <Sparkles className="w-2.5 h-2.5 opacity-70" />
      {pct}% {t("startups.match")}
    </span>
  );
}

function ThesisMatchesTab() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signalCount, setSignalCount] = useState(0);
  const [matches, setMatches] = useState<ThesisMatch[]>([]);
  const [rows, setRows] = useState<StartupListRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchPreferenceSignalCount(), fetchTopThesisMatches(24, 14)])
      .then(async ([count, m]) => {
        if (cancelled) return;
        setSignalCount(count);
        setMatches(m);
        const ids = m.map((x) => x.startup_id);
        const r = ids.length ? await fetchStartupsByIds(ids) : [];
        if (!cancelled) setRows(r);
      })
      .catch((e) => { if (!cancelled) setError(watchlistErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const matchByStartup = useMemo(() => new Map(matches.map((m) => [m.startup_id, m])), [matches]);
  // Preserve match-score order (best fit first) rather than whatever order
  // the id-list resolve query happens to return.
  const orderedRows = useMemo(
    () => matches.map((m) => rows.find((r) => r.id === m.startup_id)).filter((r): r is StartupListRow => !!r),
    [matches, rows],
  );

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-gray-400 py-10"><Loader2 className="w-4 h-4 animate-spin" />{t("watchlist.loading")}</div>;
  }
  if (error) {
    return (
      <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200/60 rounded-[8px] px-4 py-3.5">
        <AlertCircle className="w-4 h-4 text-rose-500 flex-none mt-0.5" />
        <p className="text-xs text-rose-700 leading-relaxed">{error}</p>
      </div>
    );
  }
  // signal_count < 3 is the RPC's own gate -- distinct from "calibrated but
  // truly nothing matched right now" (below), which is a normal empty state.
  if (signalCount < 3) {
    return (
      <div className="flex flex-col items-center text-center py-16 px-6 rounded-[10px] border border-dashed border-gray-200">
        <Sparkles className="w-8 h-8 text-gray-300 mb-3" />
        <p className="text-sm font-semibold text-[#0F172A]">{t("myArea.matches.calibratingTitle")}</p>
        <p className="mt-1 text-xs text-gray-400 max-w-sm">{t("myArea.matches.calibratingBlurb")}</p>
      </div>
    );
  }
  if (orderedRows.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-16 px-6 rounded-[10px] border border-dashed border-gray-200">
        <Sparkles className="w-8 h-8 text-gray-300 mb-3" />
        <p className="text-sm font-semibold text-[#0F172A]">{t("myArea.matches.emptyTitle")}</p>
        <p className="mt-1 text-xs text-gray-400 max-w-sm">{t("myArea.matches.emptyBlurb")}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-5">{t("myArea.matches.blurb")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {orderedRows.map((s) => {
          const m = matchByStartup.get(s.id);
          const loc = [s.city, s.country].filter(Boolean).join(", ");
          return (
            <div key={s.id} className="relative flex gap-3 rounded-[8px] border border-gray-100 bg-white p-4 hover:border-gray-300 hover:shadow-[0_4px_16px_rgba(15,23,42,0.05)] transition-all">
              <CompanyLogo name={s.name} website={s.website} size={30} rounded="rounded-[9px]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-sm font-bold text-[#0F172A] truncate">{s.name}</h4>
                  {m?.is_new && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 flex-none">{t("myArea.matches.newBadge")}</span>
                  )}
                </div>
                {s.description && <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-2">{s.description}</p>}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] font-medium text-gray-400">
                    {[s.industry, loc].filter(Boolean).map((c, i) => <span key={i}>{c}</span>)}
                  </div>
                  {m && <MatchBadge pct={m.match_pct} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 3 — Live Alerts & Signal Feed. Reuses the exact data layer already
// built for TopNav's bell (fetchNotifications/markNotificationRead/
// markAllNotificationsRead) -- see that file's header for why there is no
// Realtime subscription here either. NOTE: the alert-matching job that would
// populate real watchlist/thesis-match alerts does not exist yet
// (20260930000000_notification_bell_wiring.sql's own header calls this out
// explicitly) -- today this feed only ever shows the one-time onboarding
// welcome notification. The UI here is real and ready for that job's output;
// generating that output is separate, later work.
// ═════════════════════════════════════════════════════════════════════════════

function LiveAlertsTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetchNotifications(50)
      .then(setItems)
      .catch((e) => setError(watchlistErrorMessage(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function handleOpen(n: Notification) {
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      markNotificationRead(n.id).catch(() => load()); // resync on failure
    }
    if (n.link) navigate(n.link);
  }
  async function handleMarkAll() {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? now })));
    markAllNotificationsRead().catch(() => load());
  }

  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-gray-500">{t("myArea.alerts.blurb")}</p>
        {unreadCount > 0 && (
          <button onClick={handleMarkAll} className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0F172A] transition-colors flex-none">
            <CheckCheck className="w-3.5 h-3.5" />{t("myArea.alerts.markAllRead")}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-10"><Loader2 className="w-4 h-4 animate-spin" />{t("watchlist.loading")}</div>
      ) : error ? (
        <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200/60 rounded-[8px] px-4 py-3.5">
          <AlertCircle className="w-4 h-4 text-rose-500 flex-none mt-0.5" />
          <p className="text-xs text-rose-700 leading-relaxed">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center text-center py-16 px-6 rounded-[10px] border border-dashed border-gray-200">
          <Bell className="w-8 h-8 text-gray-300 mb-3" />
          <p className="text-sm font-semibold text-[#0F172A]">{t("myArea.alerts.emptyTitle")}</p>
          <p className="mt-1 text-xs text-gray-400 max-w-sm">{t("myArea.alerts.emptyBlurb")}</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 border border-gray-100 rounded-[8px] overflow-hidden">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => handleOpen(n)}
              className={`w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-gray-50 transition-colors ${!n.read_at ? "bg-indigo-50/30" : "bg-white"}`}
            >
              {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 flex-none" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#0F172A]">{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>
                <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
