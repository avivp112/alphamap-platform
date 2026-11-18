// Pure helpers for "Your Alpha" (Bench + Journal). No Supabase import, so vitest runs
// these in Node; the data calls live in ./alphaData.ts.

export const BENCH_SEATS = 7;
export const CONVICTION_MAX = 5;

export type AlphaEntityType = "startup" | "investor" | "crm";
export interface AlphaRef { type: AlphaEntityType; id: string }

export const refKey = (r: AlphaRef): string => `${r.type}:${r.id}`;

export function clampConviction(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.min(CONVICTION_MAX, Math.max(1, Math.round(n)));
}

// ── Mentions in a note: `@[Name](type:uuid)` ─────────────────────────────────

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const MENTION = new RegExp(`@\\[([^\\]\\n]{1,200})\\]\\((startup|investor|crm):(${UUID})\\)`, "g");

/** The token stored in a note body for one linked company. */
export function mentionToken(name: string, ref: AlphaRef): string {
  const clean = name.replace(/[[\]()\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || "Company";
  return `@[${clean}](${ref.type}:${ref.id})`;
}

export type NoteSegment = { kind: "text"; text: string } | { kind: "mention"; name: string; ref: AlphaRef };

export function noteSegments(body: string): NoteSegment[] {
  const out: NoteSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(new RegExp(MENTION))) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: body.slice(last, at) });
    out.push({ kind: "mention", name: m[1], ref: { type: m[2] as AlphaEntityType, id: m[3].toLowerCase() } });
    last = at + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

/** The distinct companies a note links to, in order of first mention. */
export function noteMentions(body: string): AlphaRef[] {
  const seen = new Set<string>();
  const refs: AlphaRef[] = [];
  for (const s of noteSegments(body)) {
    if (s.kind !== "mention") continue;
    const k = refKey(s.ref);
    if (!seen.has(k)) { seen.add(k); refs.push(s.ref); }
  }
  return refs;
}

/** The note as plain text: tokens become the company name. */
export function notePlainText(body: string): string {
  return noteSegments(body).map((s) => (s.kind === "text" ? s.text : s.name)).join("");
}

/** The `@query` being typed right before the caret, if any. `@` must start a word. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/[\n[\]()]/.test(query) || query.length > 40) return null;
  return { start: at, query };
}

/** Replace the `@query` with a token. Returns the new text and where the caret goes. */
export function applyMention(text: string, start: number, caret: number, token: string): { text: string; caret: number } {
  const next = `${text.slice(0, start)}${token} ${text.slice(caret)}`;
  return { text: next, caret: start + token.length + 1 };
}

// ── The Journal timeline ─────────────────────────────────────────────────────

export interface TimelineEntry<T = unknown> { id: string; at: string; kind: "note" | "alert" | "legacy"; data: T }

export function mergeTimeline<T>(entries: TimelineEntry<T>[]): TimelineEntry<T>[] {
  return [...entries].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export type DayLabel = { kind: "today" } | { kind: "yesterday" } | { kind: "date"; iso: string };
export interface DayGroup<T> { key: string; label: DayLabel; entries: TimelineEntry<T>[] }

const dayOf = (iso: string): string => iso.slice(0, 10);

/** Groups newest-first entries by UTC day, naming today and yesterday. */
export function groupByDay<T>(entries: TimelineEntry<T>[], now: Date): DayGroup<T>[] {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const groups: DayGroup<T>[] = [];
  for (const e of entries) {
    const d = dayOf(e.at);
    let g = groups[groups.length - 1];
    if (!g || g.key !== d) {
      g = { key: d, label: d === today ? { kind: "today" } : d === yesterday ? { kind: "yesterday" } : { kind: "date", iso: d }, entries: [] };
      groups.push(g);
    }
    g.entries.push(e);
  }
  return groups;
}

export type JournalFilter = "all" | "notes" | "updates";

export function matchesFilter(kind: TimelineEntry["kind"], f: JournalFilter): boolean {
  if (f === "all") return true;
  if (f === "notes") return kind === "note" || kind === "legacy";
  return kind === "alert";
}

// ── Notification types written by generate_live_alerts and friends ───────────

export type AlertKind = "filing" | "trending" | "match" | "new" | "other";

export function alertKind(type: string): AlertKind {
  if (type === "watchlist_filing") return "filing";
  if (type === "watchlist_velocity") return "trending";
  if (type === "thesis_match") return "match";
  if (type.includes("candidate") || type.includes("new_company")) return "new";
  return "other";
}

// ── The thesis sentence, from the user's mandate ─────────────────────────────

export interface ThesisParts { stages: string[]; sectors: string[]; geographies: string[] }

export function thesisParts(m: { stages?: string[] | null; sectors?: string[] | null; geographies?: string[] | null } | null | undefined): ThesisParts | null {
  if (!m) return null;
  const clean = (xs?: string[] | null) => (xs ?? []).map((x) => x.trim()).filter(Boolean);
  const parts = { stages: clean(m.stages), sectors: clean(m.sectors), geographies: clean(m.geographies) };
  return parts.stages.length + parts.sectors.length + parts.geographies.length === 0 ? null : parts;
}

/** "A, B and C"; more than `max` collapses to "A, B +2". */
export function listPhrase(xs: string[], max = 3, and = "and"): string {
  if (xs.length <= 1) return xs[0] ?? "";
  if (xs.length > max) return `${xs.slice(0, max - 1).join(", ")} +${xs.length - (max - 1)}`;
  return `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`;
}

/** Days since an ISO date/time, or null. */
export function daysAgo(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** "3 days ago", "yesterday", in the given language. Falls back to the date past 60 days. */
export function relativeTime(iso: string, lang: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const secs = Math.round((t - now) / 1000);
  const abs = Math.abs(secs);
  let rtf: Intl.RelativeTimeFormat;
  try { rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" }); } catch { rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); }
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(secs / 3600), "hour");
  if (abs < 86_400 * 60) return rtf.format(Math.round(secs / 86_400), "day");
  return new Date(t).toLocaleDateString(lang, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Mar 2026" from an ISO date, in the given language. Empty for a bad date. */
export function monthYear(iso: string | null | undefined, lang: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  try { return d.toLocaleDateString(lang, { month: "short", year: "numeric", timeZone: "UTC" }); } catch { return ""; }
}
