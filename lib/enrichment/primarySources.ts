/**
 * lib/enrichment/primarySources.ts — which sources count as PRIMARY: what
 * may confirm a value a data platform states (hints.ts), and what is a press
 * release (sources.ts). One list, edited here only (owner, 2026-10-29).
 *
 * Primary is:
 *   - the company's own website (recognised by its domain);
 *   - a press release through an official wire, below;
 *   - an official register / filing (sources.ts REGISTRY_HOSTS: SEC, Companies House);
 *   - an article in a trusted outlet (trustedNews.ts).
 * Never: a social network, a content / PR-content site, a data platform
 * (dataPlatforms.ts), a review directory.
 */

/** Official press-release wires. */
export const PRESS_WIRE_DOMAINS = ["prnewswire.com", "businesswire.com", "globenewswire.com"];

/**
 * Social networks, video sites, blogging platforms and PR-content sites:
 * anyone can publish there. SSI's "$2B Series A", Thinking Machines' "$5B",
 * HiBob's and Wayve's rounds were "confirmed" by Instagram posts, Zepto's by
 * Facebook, a $1B valuation by everything-pr.com (eval run, 2026-10-29).
 */
export const NOT_PRIMARY_DOMAINS = [
  "instagram.com", "facebook.com", "fb.com", "x.com", "twitter.com", "tiktok.com", "threads.net", "reddit.com",
  "youtube.com", "youtu.be", "linkedin.com", "pinterest.com", "quora.com", "medium.com", "substack.com",
  "everything-pr.com", "einpresswire.com", "openpr.com", "prlog.org", "issuewire.com", "newswire.com", "pr.com",
];

const hostOf = (url: string): string | null => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
};
const on = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

export function isPressWireUrl(url: string): boolean {
  const h = hostOf(url);
  return !!h && on(h, PRESS_WIRE_DOMAINS);
}

export function isNotPrimaryUrl(url: string): boolean {
  const h = hostOf(url);
  return !h || on(h, NOT_PRIMARY_DOMAINS);
}
