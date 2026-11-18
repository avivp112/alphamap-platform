// Pure helpers for the Ctrl+K palette in the top navigation.

export interface PalettePage { id: string; label: string; to: string; hint: string; keywords: string[] }

export const PALETTE_PAGES: PalettePage[] = [
  { id: "home", label: "Home", to: "/dashboard", hint: "Ask the AI analyst", keywords: ["ask", "ai", "search", "intelligence"] },
  { id: "startups", label: "Private Market", to: "/startups", hint: "Startups and funding rounds", keywords: ["startups", "companies", "funding"] },
  { id: "vcs", label: "VCs", to: "/vcs", hint: "Firms, check sizes and fund filings", keywords: ["investors", "venture", "funds", "firms"] },
  { id: "deals", label: "Deals", to: "/deals", hint: "SEC Form D filings", keywords: ["rounds", "filings", "form d"] },
  { id: "bench", label: "Your Alpha", to: "/my-area", hint: "Bench and Journal", keywords: ["bench", "journal", "notes", "watchlist", "crm", "alerts", "matches"] },
];

/** Pages whose label or keywords contain the query; all of them for an empty query. */
export function filterPages(query: string, pages: PalettePage[] = PALETTE_PAGES): PalettePage[] {
  const q = query.trim().toLowerCase();
  if (!q) return pages;
  return pages.filter((p) => p.label.toLowerCase().includes(q) || p.keywords.some((k) => k.includes(q)));
}

/** Where "Ask AlphaMap" goes for a question. */
export function askPath(question: string): string {
  return `/dashboard?q=${encodeURIComponent(question.trim())}`;
}

/** Ctrl+K on Windows and Linux, Cmd+K on Mac. */
export function isPaletteShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}

/** Wraps an index into a list of n entries (arrow-key navigation). */
export function stepIndex(i: number, delta: number, n: number): number {
  return n <= 0 ? 0 : (((i + delta) % n) + n) % n;
}
