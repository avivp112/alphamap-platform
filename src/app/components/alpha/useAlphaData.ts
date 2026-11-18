import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCrmCompanies, fetchUnreadNotificationCount } from "../../../lib/supabase";
import type { CrmCompany } from "../../../lib/crm";
import { fetchWatchlist, watchlistErrorMessage, type WatchlistData } from "../../../lib/watchlist";
import { refKey, type AlphaRef } from "../../../lib/alpha";
import {
  entityFromCrm, entityFromInvestor, entityFromStartup, fetchBench, fetchNotes, resolveEntities,
  type AlphaEntity, type AlphaNote, type BenchRow,
} from "../../../lib/alphaData";

export interface AlphaData {
  loading: boolean;
  /** Set when the watchlist or CRM could not load; the Bench and Journal fail on their own (their tables may not exist yet). */
  error: string | null;
  benchError: string | null;
  notesError: string | null;
  watchlist: WatchlistData;
  crm: CrmCompany[];
  bench: BenchRow[];
  notes: AlphaNote[];
  unread: number;
  /** Everything the page can name: watchlist, CRM, bench and linked companies. */
  entities: Map<string, AlphaEntity>;
  reload: () => void;
  setBench: React.Dispatch<React.SetStateAction<BenchRow[]>>;
  setNotes: React.Dispatch<React.SetStateAction<AlphaNote[]>>;
  setCrm: React.Dispatch<React.SetStateAction<CrmCompany[]>>;
  setUnread: React.Dispatch<React.SetStateAction<number>>;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : watchlistErrorMessage(e));

export function useAlphaData(): AlphaData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [benchError, setBenchError] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistData>({ startups: [], investors: [] });
  const [crm, setCrm] = useState<CrmCompany[]>([]);
  const [bench, setBench] = useState<BenchRow[]>([]);
  const [notes, setNotes] = useState<AlphaNote[]>([]);
  const [unread, setUnread] = useState(0);
  const [extra, setExtra] = useState<Map<string, AlphaEntity>>(new Map());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchWatchlist(), fetchCrmCompanies(),
      fetchBench().then((r) => ({ r }), (e) => ({ e })),
      fetchNotes().then((r) => ({ r }), (e) => ({ e })),
      fetchUnreadNotificationCount().catch(() => 0),
    ]).then(([w, c, b, n, u]) => {
      if (cancelled) return;
      setWatchlist(w); setCrm(c); setUnread(u); setError(null);
      if ("r" in b) { setBench(b.r); setBenchError(null); } else { setBench([]); setBenchError(msg(b.e)); }
      if ("r" in n) { setNotes(n.r); setNotesError(null); } else { setNotes([]); setNotesError(msg(n.e)); }
    }).catch((e) => { if (!cancelled) setError(msg(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const base = useMemo(() => {
    const m = new Map<string, AlphaEntity>();
    for (const s of watchlist.startups) { const e = entityFromStartup(s); m.set(refKey(e.ref), e); }
    for (const i of watchlist.investors) { const e = entityFromInvestor(i); m.set(refKey(e.ref), e); }
    for (const c of crm) { const e = entityFromCrm(c); m.set(refKey(e.ref), e); }
    return m;
  }, [watchlist, crm]);

  // Bench seats and note links can point at companies that are in neither list.
  useEffect(() => {
    const wanted: AlphaRef[] = [...bench.map((b) => b.ref), ...notes.flatMap((n) => n.links)];
    const missing = wanted.filter((r) => !base.has(refKey(r)) && !extra.has(refKey(r)));
    if (missing.length === 0) return;
    let cancelled = false;
    resolveEntities(missing, crm).then((m) => { if (!cancelled && m.size) setExtra((prev) => new Map([...prev, ...m])); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [bench, notes, base, extra, crm]);

  const entities = useMemo(() => new Map([...extra, ...base]), [extra, base]);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { loading, error, benchError, notesError, watchlist, crm, bench, notes, unread, entities, reload, setBench, setNotes, setCrm, setUnread };
}
