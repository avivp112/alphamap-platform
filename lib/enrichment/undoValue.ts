/**
 * lib/enrichment/undoValue.ts — taking ONE value of a wet batch back (owner, 2026-11-09: w3.23, a cut headline, in a batch of 25).
 * The whole-run undo (scripts/undo_run.ts) puts a column back as it was; one value of a list column (news, competitors, leadership,
 * founders) is removed from the list as it is NOW, so what else changed since stays. Pure; scripts/undo_value.ts does the I/O.
 */
import { normalizeUrlForMatch } from "./extractMarket.ts";

export type ValueField = "news" | "competitor_declared" | "competitor_market" | "leader" | "board" | "founder";

/** The startups column each batch field lives in, and what to match an entry by. */
export const LIST_COLUMN: Record<ValueField, { column: string; by: "url" | "name" }> = {
  news: { column: "news", by: "url" },
  competitor_declared: { column: "competitors", by: "name" },
  competitor_market: { column: "competitors", by: "name" },
  leader: { column: "leadership", by: "name" },
  board: { column: "leadership", by: "name" },
  founder: { column: "founders", by: "name" },
};

export const isValueField = (f: string): f is ValueField => f in LIST_COLUMN;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** The name in a batch value: "Name — role · bio" for people, the name itself for a competitor. */
export const nameOfValue = (value: string) => value.split(" — ")[0].trim();

/** The list without the entry the batch value is. `removed` is that entry, or null when it is not there (already gone, or never matched). */
export function removeFromList<T extends Record<string, unknown>>(field: ValueField, list: T[] | null | undefined, value: string, sourceUrl: string | null): { next: T[]; removed: T | null } {
  const items = Array.isArray(list) ? list : [];
  const { by } = LIST_COLUMN[field];
  const at = items.findIndex((x) => {
    if (by === "url") return !!sourceUrl && typeof x.url === "string" && normalizeUrlForMatch(x.url) === normalizeUrlForMatch(sourceUrl);
    return typeof x.name === "string" && norm(x.name) === norm(nameOfValue(value));
  });
  if (at < 0) return { next: items, removed: null };
  return { next: items.filter((_, i) => i !== at), removed: items[at] };
}

/** The field_provenance field a written value got (writeCompany.ts listKey). */
export function provenanceFieldOf(field: ValueField, value: string): string {
  if (field === "news") return `news.${value.split(" — ").slice(1).join(" — ").slice(0, 120)}`;
  if (field === "leader" || field === "board") return `leadership.${nameOfValue(value)}`;
  if (field === "founder") return `founders.${nameOfValue(value)}`;
  return "market.competitors";
}
