// Questions the user asked the AI analyst, kept on this device only (no account storage).
export const RECENT_KEY = "am_recent_questions";
export const RECENT_MAX = 5;

/** Newest first, de-duplicated ignoring case and spacing, capped. Pure. */
export function addRecent(list: string[], question: string, max = RECENT_MAX): string[] {
  const q = question.trim().replace(/\s+/g, " ");
  if (!q) return list.slice(0, max);
  const key = q.toLowerCase();
  return [q, ...list.filter((x) => x.toLowerCase() !== key)].slice(0, max);
}

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecent(question: string): string[] {
  const next = addRecent(loadRecent(), question);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage blocked: the list just does not persist */ }
  return next;
}

export function clearRecent(): void {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* nothing to clear */ }
}
