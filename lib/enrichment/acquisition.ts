/**
 * The company was acquired (owner, round 10): enriched as usual, and in addition status, acquirer, date, source and quote.
 * Read from a headline or a sentence of an article in which the company is the one acquired — in English, Polish, Spanish, Portuguese, German, French, Hebrew.
 * A controlling / majority stake is "majority_acquired". A partner, a buyer or a company that only joins something is not acquired.
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BUY = "(?:completes (?:its |the )?acquisition of|completed (?:its |the )?acquisition of|announces (?:its |the )?acquisition of|acquires?|acquired|buys|bought|buyout of|snaps up|picks up|takes over|to acquire|to buy|przejmuje|przejął|przejęła|kupuje|adquiere|adquirió|adquirida|compra|compró|übernimmt|übernahm|rachète|rachètent|acquiert|רוכשת|רכשה|רוכש)";
const BOUGHT_BY = "(?:acquired by|bought by|sold to|taken over by|to be acquired by|is being acquired by|adquirida por|przejęta przez|übernommen von|racheté par|נרכשה על ידי|נרכשת על ידי)";
const MAJORITY = /\b(?:control\w*|majority)\s+(?:stake|share|shares|interest|package|holding)|\bstake\s+in\b|\bprzejmuje\s+(?:większościowy|kontrolny|kontrol)|\bpakiet\s+(?:kontrolny|większościowy)|\bwiększościow|\bparticipaci[oó]n\s+mayoritaria|\bmayor[ií]a\b|\bmehrheit|\bparticipation\s+majoritaire|\bprise\s+de\s+contr[oô]le|\bmajorit[eé]\b|\bmaggioranza|\bmaioria|\bcontrole\s+acion[aá]rio|\bמניית\s+שליטה|\bשליטה\s+ב/i;

export interface AcquisitionClaim { status: "acquired" | "majority_acquired"; acquirer: string; quote: string; url: string; date: string | null }


const WORD = "\\p{Lu}[\\p{L}\\d&.'’-]*";
const TRAILING = new RegExp(`((?:${WORD}\\s+){0,3}${WORD})\\W*$`, "u");
const LEADING = new RegExp(`^\\W*((?:${WORD}\\s+){0,3}${WORD})`, "u");
const DESCRIPTOR_THEN_NAME = new RegExp(`^(?:[\\p{L}\\d-]+\\s+){0,6}?(?:company|firm|startup|start-up|giant|provider|maker|group|bank|platform|vendor|leader|player|unicorn|business|developer|operator|specialist|powerhouse)\\s+((?:${WORD}\\s+){0,3}${WORD})`, "u");
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
    const restText = afterName.slice(passive[0].length);
    // "acquired by Australian HR software company Employment Hero": the buyer is the name after the descriptor noun, not the words that describe it (owner, batch 5 gate: Humi).
    const apposed = restText.match(DESCRIPTOR_THEN_NAME);
    const lead = apposed ? ([apposed[0], apposed[1]] as RegExpMatchArray) : restText.match(LEADING);
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

/** A buyer's name as a key: case, punctuation and a closing "Group", "Inc", "Ltd"… do not make it another buyer ("Żabka" and "Żabka Group"). */
export function buyerKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+(?:group|inc|ltd|llc|limited|corp|corporation|plc|holdings?|ag|gmbh|sa|s a)\s*$/u, "").replace(/[^\p{L}\p{N}]+/gu, "");
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
  const pick0 = claims.find((c) => c.status === "acquired") ?? claims[0];
  // One announcement said "acquires X" and another, days later, says what was bought: a controlling / majority stake. The more exact statement of the same event gives the status; the date stays the first
  // announcement's (owner, regression gate: Dietly — "Żabka przejmuje platformę" 2021-06-01 and "Acquires Controlling Stake" 2021-06-03).
  const fk = buyerKey;
  const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
  const majoritySameEvent = pick0.status === "acquired" && claims.some((c) => c.status === "majority_acquired" && fk(c.acquirer) === fk(pick0.acquirer) && c.date && pick0.date && days(c.date, pick0.date) <= 14);
  const pick = majoritySameEvent ? { ...pick0, status: "majority_acquired" as const } : pick0;
  // The date of the purchase is the date of its first announcement: later reports of the same purchase by the same buyer do not move it (owner, batch 7: Kashat, two reports ten days apart).
  const f = buyerKey;
  // (the reports of one purchase: the same buyer; a majority stake and a full purchase count as one event only within four months — a stake taken years before is another event)
  const same = claims.filter((c) => f(c.acquirer) === f(pick.acquirer) && c.date && (c.status === pick.status || !pick.date || days(c.date, pick.date) <= 120));
  const first = same.length ? same[same.length - 1] : pick;
  return majoritySameEvent ? { ...first, status: "majority_acquired" } : first;
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


// ── the purchase as one event (owner, 2026-11-19: Dietly, UltraVox) ───────────────────────────────────────────────────────────────────────────────────────────
export interface PurchaseItem { title: string; url: string; published_date?: string | null; date_basis?: string; [k: string]: unknown }
const plain = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/**
 * The reports of one purchase, from the dated items that passed the source and entity gates. A report is of the purchase when it says the same buyer bought the company, or when it names
 * the company and the buyer within ten days of the first such report ("Dietly.pl … staje się częścią Grupy Żabka"). Of them the representative is the earliest — among those whose date is
 * not read from the page's code when any is (a blog's meta date of 09-30 beside the press release's 10-01 in its address) — and only one that `eligible` says may be written (the writer's own rules,
 * so the event is never left with nothing, owner: Medipass). The status is majority_acquired when any report of the event says a controlling / majority stake. A majority stake and a full purchase
 * more than four months apart are two events.
 */
export function purchaseEvents<T extends PurchaseItem>(items: T[], companyName: string, eligible: (x: T) => boolean = () => true, isParty: (x: T) => boolean = () => false): Array<{ buyer: string; majority: boolean; members: T[]; rep: T }> {
  const dated = items.filter((x) => x.published_date);
  const hits = dated.map((x) => ({ x, h: acquirerIn(x.title, companyName) })).filter((e): e is { x: T; h: { acquirer: string; majority: boolean } } => !!e.h);
  const byBuyer = new Map<string, typeof hits>();
  // One buyer under several spellings ("Inworld", "Inworld AI", "AI Research Lab Inworld"): a key that contains another is the same buyer.
  for (const e of [...hits].sort((a, b) => buyerKey(a.h.acquirer).length - buyerKey(b.h.acquirer).length)) {
    const k0 = buyerKey(e.h.acquirer);
    const k = [...byBuyer.keys()].find((x) => x.length >= 4 && k0.length >= 4 && (k0.includes(x) || x.includes(k0))) ?? k0;
    (byBuyer.get(k) ?? byBuyer.set(k, []).get(k)!).push(e);
  }
  const out: Array<{ buyer: string; majority: boolean; members: T[]; rep: T }> = [];
  for (const [key, list] of byBuyer) {
    const sorted = [...list].sort((a, b) => String(a.x.published_date).localeCompare(String(b.x.published_date)));
    const first = { ...sorted[0], h: { ...sorted[0].h, acquirer: [...list].map((e) => e.h.acquirer).sort((a, b) => a.length - b.length)[0] } };   // the cleanest spelling: the shortest
    // the stake and the full purchase of another time are other events: only hits of the first one's kind, or within four months, belong here
    const cluster = sorted.filter((e) => e.h.majority === first.h.majority || dayDiff(String(e.x.published_date), String(first.x.published_date)) <= 120);
    const word = plain(first.h.acquirer).split(" ")[0];
    const co = plain(companyName).split(" ")[0];
    const mentions = dated.filter((x) => !cluster.some((e) => e.x === x) && !hits.some((e) => e.x === x) && word.length >= 4 && plain(x.title).includes(word) && plain(x.title).includes(co) && dayDiff(String(x.published_date), String(first.x.published_date)) <= 10);
    const members = [...cluster.map((e) => e.x), ...mentions];
    const majority = cluster.some((e) => e.h.majority);
    const ok = members.filter(eligible);
    if (!ok.length) continue;
    // The party's own announcements (the company's, the buyer's, a wire release) stand first; among the candidates a date that is not read from a page's code stands before one that is.
    const partyOk = ok.filter(isParty);
    const base = partyOk.length ? partyOk : ok;
    const trusted = base.filter((x) => x.date_basis !== "code");
    const pool = trusted.length ? trusted : base;
    // Always the same one, whatever the order the searches returned them in: the earliest date, then the report that states the purchase, then the address.
    const isHit = (x: T) => hits.some((e) => e.x === x);
    const rep = [...pool].sort((a, b) => String(a.published_date).localeCompare(String(b.published_date)) || (isHit(b) ? 1 : 0) - (isHit(a) ? 1 : 0) || a.url.localeCompare(b.url))[0];
    out.push({ buyer: first.h.acquirer, majority, members, rep });
    void key;
  }
  return out;
}

/** The purchase the news items carry (set by finishNews on each event's representative); the later full purchase wins over an earlier stake. */
export function claimFromEvents(items: Array<{ title: string; url: string; published_date?: string | null; event_buyer?: unknown; event_majority?: unknown }>): AcquisitionClaim | null {
  const ev = items.filter((x) => typeof x.event_buyer === "string" && x.published_date);
  if (!ev.length) return null;
  const sorted = [...ev].sort((a, b) => String(b.published_date).localeCompare(String(a.published_date)));
  const pick = sorted.find((x) => !x.event_majority) ?? sorted[0];
  return { status: pick.event_majority ? "majority_acquired" : "acquired", acquirer: String(pick.event_buyer), quote: pick.title, url: pick.url, date: pick.published_date ?? null };
}
