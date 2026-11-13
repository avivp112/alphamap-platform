/**
 * Finding a market candidate's own site (owner, 2026-11-12: a search for "Livi official website" returned a web-template company, "Linnworks" a
 * tracking pixel). The query carries the context words of the sentence that named the candidate ("telehealth", "insurance"), and the address chosen
 * must be the candidate's own: its host carries the candidate's name.
 */
const STOP = new Set(["the", "and", "with", "for", "that", "this", "from", "have", "has", "are", "was", "were", "their", "its", "including", "such", "like", "also", "other", "competes", "competing", "competitors", "competitor", "players", "market", "among", "include", "includes", "alternatives", "alternative", "best", "top", "compare"]);
const BAD_HOST = /(^|\.)(wikipedia\.org|linkedin\.com|crunchbase\.com|facebook\.com|twitter\.com|x\.com|youtube\.com|play\.google\.com|apps\.apple\.com|instagram\.com|reddit\.com|g2\.com|capterra\.com|trustpilot\.com|tracxn\.com|pitchbook\.com|zoominfo\.com|glassdoor\.com|indeed\.com)$/i;

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const letters = (s: string) => fold(s).replace(/[^a-z0-9]/g, "");

/** Up to four content words of the sentence that are not the candidate's or the company's own name. */
export function contextWords(quote: string, names: string[]): string[] {
  const skip = new Set(names.flatMap((n) => fold(n).split(/[^a-z0-9]+/)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of fold(quote).split(/[^a-z0-9]+/)) {
    if (w.length < 5 || STOP.has(w) || skip.has(w) || /\d/.test(w) || seen.has(w)) continue;
    seen.add(w); out.push(w);
    if (out.length === 4) break;
  }
  return out;
}

export const peerSiteQuery = (name: string, quote: string, company: string): string => `"${name}" ${contextWords(quote, [name, company]).join(" ")} official site`.replace(/\s+/g, " ").trim();

/** The result whose host is the candidate's own (its host carries the name); null when none does. */
export function pickPeerSite(results: Array<{ url: string }>, name: string): string | null {
  const key = letters(name);
  if (key.length < 3) return null;
  for (const r of results) {
    let host = "";
    try { host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; }
    if (BAD_HOST.test(host)) continue;
    const label = host.split(".").slice(0, -1).join("");
    if (letters(label).includes(key) || key.includes(letters(label.split("-")[0])) && letters(label.split("-")[0]).length >= 4) return new URL(r.url).origin;
  }
  return null;
}
