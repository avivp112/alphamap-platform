/**
 * The company was acquired (owner, round 10): enriched as usual, and in addition status, acquirer, date, source and quote.
 * Read from a headline or a sentence of an article in which the company is the one acquired — in English, Polish, Spanish, Portuguese, German, French, Hebrew.
 * A controlling / majority stake is "majority_acquired". A partner, a buyer or a company that only joins something is not acquired.
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BUY = "(?:completes (?:its |the )?acquisition of|completed (?:its |the )?acquisition of|announces (?:its |the )?acquisition of|acquires?|acquired|buys|bought|buyout of|snaps up|picks up|takes over|to acquire|to buy|przejmuje|przejął|przejęła|kupuje|adquiere|adquirió|adquirida|compra|compró|übernimmt|übernahm|rachète|rachètent|acquiert|רוכשת|רכשה|רוכש)";
const BOUGHT_BY = "(?:acquired by|bought by|sold to|taken over by|to be acquired by|is being acquired by|adquirida por|przejęta przez|übernommen von|racheté par|נרכשה על ידי|נרכשת על ידי)";
const MAJORITY = /\b(?:controlling|majority)\s+(?:stake|share|interest)|\bstake\s+in\b|\bprzejmuje\s+(?:większościowy|kontrolny)|\bparticipaci[oó]n\s+mayoritaria|\bmehrheit|\bparticipation\s+majoritaire|\bמניית\s+שליטה/i;

export interface AcquisitionClaim { status: "acquired" | "majority_acquired"; acquirer: string; quote: string; url: string; date: string | null }


const WORD = "\\p{Lu}[\\p{L}\\d&.'’-]*";
const TRAILING = new RegExp(`((?:${WORD}\\s+){0,3}${WORD})\\W*$`, "u");
const LEADING = new RegExp(`^\\W*((?:${WORD}\\s+){0,3}${WORD})`, "u");
const GENERIC_BUYER = /^(?:US|UK|EU|The|An?|Its|It|Investors?|Group|Company|Firm)$/i;
/** A country, a region or a demonym in front of the buyer's name ("Egypts Raseedi", "Egypt's Raseedi", "UK-based Acme", "Indian Acme") is not part of it (owner, batch 7). */
const REGION_PREFIX = /^(?:(?:Egypt|India|Nigeria|Kenya|Ghana|Brazil|Mexico|Argentina|Chile|Colombia|Israel|Germany|France|Spain|Italy|Poland|Japan|China|Korea|UK|US|USA|UAE|Saudi|Canada|Australia|Singapore|Turkey|Sweden|Norway|Denmark|Finland|Ireland|Netherlands|Switzerland|Africa|Europe|Asia|Britain|American|British|Indian|Egyptian|German|French|Spanish|Italian|Polish|Japanese|Chinese|Korean|Israeli|Nigerian|Brazilian|Mexican|Canadian|Australian|Swedish|Dutch|Swiss|Emirati|Turkish|African|European|Asian)(?:['’]s|s)?|[A-Za-z]{2,4}-based)\s+(?=\p{Lu})/u;
const trimName = (s: string) => s.replace(REGION_PREFIX, "").replace(/[.,;]+$/, "").replace(/\s+(?:Group|Inc|Ltd|LLC|Limited|Corp|plc)$/i, (m) => m).trim();

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
  // "Sale of <Company> … to X", "<Company> sold to X" (the seller's headline)
  if (/\b(?:sale of|sells?|sold|divest(?:s|ed|iture of)?)\s*$/i.test(text.slice(Math.max(0, nm.index - 14), nm.index)) || /^[^.:;|]{0,60}?\b(?:sale|sold|divestiture)\b/i.test(afterName)) {
    const to = afterName.match(/\b[Tt][Oo]\s+(?=\p{Lu})/u);
    if (to && to.index != null) {
      const lead = afterName.slice(to.index + to[0].length).match(LEADING);
      const a = lead && trimName(lead[1]);
      if (a && !GENERIC_BUYER.test(a) && !sameName(a, companyName)) return { acquirer: a, majority };
    }
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
  const pick = claims.find((c) => c.status === "acquired") ?? claims[0];
  // The date of the purchase is the date of its first announcement: later reports of the same purchase by the same buyer do not move it (owner, batch 7: Kashat, two reports ten days apart).
  const f = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const same = claims.filter((c) => f(c.acquirer) === f(pick.acquirer) && c.date);
  return same.length ? same[same.length - 1] : pick;
}

/** The buyers that at least `minAgree` of these headlines name for the company: with them known, an article that says they bought it is about this company, not one of the same name (owner, batch 7: OUTvest, Alexforbes). */
export function knownAcquirers(titles: string[], companyName: string, minAgree = 2): string[] {
  const f = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const count = new Map<string, { name: string; n: number }>();
  for (const t of titles) {
    const hit = acquirerIn(t, companyName);
    if (!hit) continue;
    const k = f(hit.acquirer), e = count.get(k) ?? { name: hit.acquirer, n: 0 };
    e.n++; count.set(k, e);
  }
  return [...count.values()].filter((e) => e.n >= minAgree).map((e) => e.name);
}
