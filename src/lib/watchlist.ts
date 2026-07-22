import { useCallback, useEffect, useState } from "react";
import { supabase, type StartupListRow, type InvestorRow } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// My Watchlist — lets a signed-in user track specific startups and investors.
// Backed by the real `watchlist_items` table (RLS-scoped to auth.uid()), not a
// local placeholder — a tracked item persists across devices/sessions like any
// other real data in this app.
//
// entity_id is polymorphic (startups.id or investors.id depending on
// entity_type), so there's no DB-level join possible; fetchWatchlist() reads
// the tracked ids first, then fetches the two tables by id list and returns
// them separately.
// ─────────────────────────────────────────────────────────────────────────────

export type WatchlistEntityType = "startup" | "investor";

export interface WatchlistRef {
  entityType: WatchlistEntityType;
  entityId: string;
}

export interface WatchlistData {
  startups: StartupListRow[];
  investors: InvestorRow[];
}

function watchlistKey(entityType: WatchlistEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("You must be signed in to manage your watchlist.");
  return data.user.id;
}

export async function fetchWatchlist(): Promise<WatchlistData> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { startups: [], investors: [] };

  const { data: items, error } = await supabase
    .from("watchlist_items")
    .select("entity_type, entity_id")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const startupIds  = (items ?? []).filter((i) => i.entity_type === "startup").map((i) => i.entity_id);
  const investorIds = (items ?? []).filter((i) => i.entity_type === "investor").map((i) => i.entity_id);

  const [startupsRes, investorsRes] = await Promise.all([
    startupIds.length
      ? supabase.from("startups_search").select("*").in("id", startupIds)
      : Promise.resolve({ data: [], error: null }),
    investorIds.length
      ? supabase.from("investors").select("*").in("id", investorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (startupsRes.error) throw startupsRes.error;
  if (investorsRes.error) throw investorsRes.error;

  // Preserve the tracked order (most-recently-added first) rather than
  // whatever order the IN-list queries happen to return.
  const startupById  = new Map((startupsRes.data as StartupListRow[]).map((s) => [s.id, s]));
  const investorById = new Map((investorsRes.data as InvestorRow[]).map((i) => [i.id, i]));

  return {
    startups:  startupIds.map((id) => startupById.get(id)).filter((s): s is StartupListRow => !!s),
    investors: investorIds.map((id) => investorById.get(id)).filter((i): i is InvestorRow => !!i),
  };
}

export async function addToWatchlist(entityType: WatchlistEntityType, entityId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("watchlist_items")
    .insert({ user_id: userId, entity_type: entityType, entity_id: entityId });
  // Re-adding an already-tracked item hits the UNIQUE constraint — treat that
  // as a no-op success rather than an error.
  if (error && error.code !== "23505") throw error;
}

export async function removeFromWatchlist(entityType: WatchlistEntityType, entityId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("watchlist_items")
    .delete()
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (error) throw error;
}

// Postgrest errors (thrown as-is by addToWatchlist/removeFromWatchlist above)
// aren't `Error` instances — they're plain `{ message, details, hint, code }`
// objects — so a naive `err instanceof Error` check misses them and falls
// back to a generic message. Surfacing the real text matters here: e.g. a
// missing `watchlist_items` table (migration not yet run) reads as
// `relation "public.watchlist_items" does not exist`, which is the kind of
// thing that should show up in the UI, not get silently swallowed.
export function watchlistErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "Couldn't update your watchlist. Please try again.";
}

// ── Membership hook — quick "is this already tracked?" lookups for UI ───────
export interface WatchlistMembership {
  ids: Set<string>;
  loading: boolean;
  has: (entityType: WatchlistEntityType, entityId: string) => boolean;
  refresh: () => void;
}

export function useWatchlistMembership(): WatchlistMembership {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWatchlist()
      .then((data) => {
        if (cancelled) return;
        const next = new Set<string>();
        for (const s of data.startups)  next.add(watchlistKey("startup", s.id));
        for (const i of data.investors) next.add(watchlistKey("investor", i.id));
        setIds(next);
      })
      .catch(() => { if (!cancelled) setIds(new Set()); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const has = useCallback(
    (entityType: WatchlistEntityType, entityId: string) => ids.has(watchlistKey(entityType, entityId)),
    [ids],
  );
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { ids, loading, has, refresh };
}
