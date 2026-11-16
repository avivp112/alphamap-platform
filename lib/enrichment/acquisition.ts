/**
 * The company was acquired (owner, round 10): enriched as usual, and in addition status, acquirer, date, source and quote.
 * Read from a headline or a sentence of an article in which the company is the one acquired — in English, Polish, Spanish, Portuguese, German, French, Hebrew.
 * A controlling / majority stake is "majority_acquired". A partner, a buyer or a company that only joins something is not acquired.
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BUY = "(?:acquires?|acquired|buys|bought|buyout of|snaps up|picks up|takes over|to acquire|to buy|przejmuje|przejął|przejęła|kupuje|adquiere|adquirió|adquirida|compra|compró|übernimmt|übernahm|rachète|rachètent|acquiert|רוכשת|רכשה|רוכש)";
const BOUGHT_BY = "(?:acquired by|bought by|sold to|taken over by|to be acquired by|is being acquired by|adquirida por|przejęta przez|übernommen von|racheté par|נרכשה על ידי|נרכשת על ידי)";
const MAJORITY = /\b(?:controlling|majority)\s+(?:stake|share|interest)|\bstake\s+in\b|\bprzejmuje\s+(?:większościowy|kontrolny)|\bparticipaci[oó]n\s+mayoritaria|\bmehrheit|\bparticipation\s+majoritaire|\bמניית\s+שליטה/i;

export interface AcquisitionClaim { status: "acquired" | "majority_acquired"; acquirer: string; quote: string; url: string; date: string | null }


const WORD = "\\p{Lu}[\\p{L}\\d&.'’-]*";
const TRAILING = new RegExp(`((?:${WORD}\\s+){0,3}${WORD})\\W*$`, "u");
const LEADING = new RegExp(`^\\W*((?:${WORD}\\s+){0,3}${WORD})`, "u");
const GENERIC_BUYER = /^(?:US|UK|EU|The|An?|Its|It|Investors?|Group|Company|Firm)$/i;
const trimName = (s: string) => s.replace(/[.,;]+$/, "").replace(/\s+(?:Group|Inc|Ltd|LLC|Limited|Corp|plc)$/i, (m) => m).trim();

/** Who bought `companyName` according to one sentence or headline, or null when it is not stated that the company was acquired. */
export function acquirerIn(text: string, companyName: string): { acquirer: string; majority: boolean } | null {
  const name = esc(companyName.trim()).replace(/\s+/g, "\\s+");
  const nameRe = new RegExp(`\\b${name}\\b`, "i");
  const majority = MAJORITY.test(text);
  const nm = text.match(nameRe);
  if (!nm || nm.index == null) return null;
  // "<Company> … acquired by X"
  const afterName = text.slice(nm.index + nm[0].length);
  const passive = afterName.match(new RegExp(`^[^.:;|]{0,60}?\\b${BOUGHT_BY}\\s+`, "i"));
  if (passive) {
    const lead = afterName.slice(passive[0].length).match(LEADING);
    const a = lead && trimName(lead[1]);
    if (a && !GENERIC_BUYER.test(a) && !sameName(a, companyName)) return { acquirer: a, majority };
  }
  // "X acquires … <Company>": the verb before the name, the buyer just before the verb
  const before = text.slice(0, nm.index);
  const verb = [...before.matchAll(new RegExp(`\\b${BUY}\\b`, "gi"))].pop();
  if (verb && verb.index != null && before.slice(verb.index + verb[0].length).length <= 90 && !/[.:;|]/.test(before.slice(verb.index + verb[0].length))) {
    const t = before.slice(0, verb.index).match(TRAILING);
    const a = t && trimName(t[1]);
    if (a && !GENERIC_BUYER.test(a) && !sameName(a, companyName)) return { acquirer: a, majority };
  }
  return null;
}

function sameName(a: string, b: string): boolean {
  const f = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return f(a) === f(b) || f(a).includes(f(b)) || f(b).includes(f(a));
}

/** The acquisition, if any, that these articles (title + text) state about the company; the newest dated one wins. */
export function detectAcquisition(articles: Array<{ url: string; title?: string | null; content?: string | null; date?: string | null }>, companyName: string): AcquisitionClaim | null {
  const claims: AcquisitionClaim[] = [];
  for (const a of articles) {
    const candidates = [a.title ?? "", ...(a.content ?? "").split(/(?<=[.!?])\s+|\n+/).slice(0, 400)].map((x) => x.trim()).filter((x) => x.length > 20 && x.length < 400);
    for (const c of candidates) {
      if (!new RegExp(`\\b${esc(companyName.trim()).replace(/\s+/g, "\\s+")}\\b`, "i").test(c)) continue;
      const hit = acquirerIn(c, companyName);
      if (hit) { claims.push({ status: hit.majority ? "majority_acquired" : "acquired", acquirer: hit.acquirer, quote: c, url: a.url, date: a.date ?? null }); break; }
    }
  }
  if (!claims.length) return null;
  // A full acquisition after a majority stake: the full one stands; otherwise the newest.
  claims.sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
  return claims.find((c) => c.status === "acquired") ?? claims[0];
}
