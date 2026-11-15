/**
 * lib/enrichment/pageText.ts — a page's text for the model, and for the verifier (owner, 2026-11-15, round 7).
 * Pages were cut to their first 6000 characters, so what sits lower (an address, the founders, the sentence that supports a claim) was lost: "MOFT sells
 * portable tech accessories" and "3, 6, 9 or 12 months" were dropped as unsupported although the page says them. Now:
 *   - the verifier always reads the page whole (content);
 *   - the model gets prompt_content: the text without navigation and menus, and when it is still long, the opening plus the passages around the words that carry
 *     headquarters, founders and the company's own description, plus the footer.
 * Pure.
 */

// Strong words first: where the company is and who started it; the weaker ones (its customers, its products) only fill what is left.
const STRONG = /\b(head ?quarters?|head office|hq|registered office|our office|address|located in|based in|founded|founder|co-?founders?|founding team|ceo|chief executive|managing director)\b/gi;
const WEAK = /\b(about us|who we are|our (?:story|mission|team|customers|products)|customers?|clients?|solutions?|industries|trusted by|used by)\b/gi;

/** Lines that are navigation: link-only lines, a run of short menu items, cookie notices, skip links. */
export function stripNavigation(text: string): string {
  const out: string[] = [];
  let shortRun: string[] = [];
  // A menu is a long run of very short items; marketing pages are also made of short lines (owner, round 10: Promethean's 14 pages shrank to 2,092 characters).
  const isMenuRun = (run: string[]) => run.length >= 8 && run.every((l) => l.split(/\s+/).length <= 3);
  const flush = () => { if (!isMenuRun(shortRun)) out.push(...shortRun); shortRun = []; };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); out.push(""); continue; }
    const withoutLinks = line.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/https?:\/\/\S+/g, "").replace(/[*_`|•·>\-–—]/g, "").trim();
    const isLinkOnly = /\]\(/.test(line) && withoutLinks.length === 0;
    const isCookie = /\b(cookies?|accept all|manage preferences|privacy settings|consent)\b/i.test(line) && line.length < 220;
    const isSkip = /^(skip to|jump to|menu$|close$|open menu|toggle)/i.test(line);
    if (isLinkOnly || isCookie || isSkip) { flush(); continue; }
    const isShort = line.replace(/^#+\s*/, "").length < 28 && !/[.!?:]$/.test(line) && !/^#/.test(line);
    if (isShort) shortRun.push(line); else { flush(); out.push(line); }
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The text sent to the model: at most `max` characters, nothing the verifier could not find in the full page. */
export function promptText(full: string, max = 6000): string {
  let clean = stripNavigation(full);
  // The cleaning must not eat the page: when most of it went, the page itself (links and cookie lines aside) is what the model reads.
  if (clean.length < full.length * 0.4 && full.length - clean.length > 600) clean = full.replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= max) return clean;
  const head = Math.floor(max * 0.45), foot = Math.min(700, Math.floor(max * 0.1));
  const picks: Array<[number, number]> = [[0, head]];
  const budget = max - head - foot;
  let used = 0;
  const hits = [...clean.matchAll(STRONG), ...clean.matchAll(WEAK)];
  for (const m of hits) {
    const at = m.index ?? 0;
    if (at < head || at > clean.length - foot) continue;
    const a = Math.max(head, at - 220), b = Math.min(clean.length - foot, at + 380);
    if (picks.some(([x, y]) => a < y && b > x)) { const last = picks.find(([x, y]) => a < y && b > x)!; const grow = Math.max(0, b - last[1]); if (used + grow <= budget) { last[1] = Math.max(last[1], b); used += grow; } continue; }
    if (used + (b - a) > budget) continue;
    picks.push([a, b]); used += b - a;
  }
  picks.sort((p, q) => p[0] - q[0]);
  const parts = picks.map(([a, b]) => clean.slice(a, b));
  parts.push(clean.slice(clean.length - foot));
  return parts.join("\n…\n").slice(0, max);
}

/** Text of a page's HTML: scripts, styles and comments gone, headings kept as "# ", blocks as lines. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _l, t: string) => `\n# ${t.replace(/<[^>]+>/g, " ")}\n`)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[4-6]|\/section|\/article|\/footer|\/header)\s*\/?>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => { const txt = t.replace(/<[^>]+>/g, " ").trim(); return /^https?:/.test(href) ? `[${txt || href}](${href})` : txt; })
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
