/**
 * lib/enrichment/numberForms.ts — a number of a sentence is in a source when the source writes the same value in its own way (owner, batch 7: "2,500" on a Portuguese page is "2.500";
 * "2.5B", "2,5 mil", "R$ 2,5 milhões", "2 500"). Values, not strings: every plausible reading of a token is a value, and the claim matches when one of them equals it.
 */
const UNITS: Array<[RegExp, number]> = [
  [/^(?:k|mil|mille|thousand|thousands|tausend|tusind|tusen|tuhat)\b/i, 1e3],
  [/^(?:m|mn|mm|mio|mln|mill?|milh(?:ão|ao|ões|oes)|mill?(?:ón|on|ones)|million|millions|millionen|miljoen|miljoner|miljon|milion(?:y|ów)?)\b/i, 1e6],
  [/^(?:b|bn|bi|bilh(?:ão|ao|ões|oes)|billion|billions|miljard|milliard|milliarden|mil\s?millones|mrd)\b/i, 1e9],
];
/** The values a numeric token can mean: thousands marks (. , space) or a decimal mark, with an optional unit word after it. */
export function tokenValues(token: string, unitText = ""): number[] {
  const t = token.replace(/[ \s]/g, (m, off, all) => (/^\d{3}$/.test(all.slice(off + 1, off + 4)) ? "" : m));
  const out = new Set<number>();
  const seps = t.match(/[.,]/g) ?? [];
  const add = (n: number) => { if (Number.isFinite(n)) out.add(n); };
  if (!seps.length) add(Number(t));
  else {
    const last = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    const after = t.length - last - 1;
    const kinds = new Set(seps);
    if (kinds.size === 2) add(Number(t.slice(0, last).replace(/[.,]/g, "") + "." + t.slice(last + 1)));          // 1.234,56 / 1,234.56
    else if (seps.length > 1) add(Number(t.replace(/[.,]/g, "")));                                                  // 1.234.567
    else if (after === 3) { add(Number(t.replace(/[.,]/g, ""))); add(Number(t.replace(",", "."))); }                // 2.500 / 2,500: thousands, or a decimal
    else add(Number(t.replace(",", ".")));                                                                          // 2,5 / 2.5
  }
  const mult = UNITS.find(([re]) => re.test(unitText.trim()))?.[1] ?? 1;
  return [...out].map((v) => Math.round(v * mult * 1000) / 1000);
}

/** Every value a text states, in every plausible reading. */
export function numberValuesIn(text: string): Set<number> {
  const out = new Set<number>();
  const re = /(?<![\p{L}\d])\d{1,3}(?:[.,  ]\d{3})+(?:[.,]\d+)?|(?<![\p{L}\d])\d+(?:[.,]\d+)?/gu;
  for (const m of text.matchAll(re)) {
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 22).replace(/^\s?(?:R\$|US\$|\$|€|£)?\s?/, (x) => (x.trim() ? "" : " "));
    for (const v of tokenValues(m[0], after)) out.add(v);
    for (const v of tokenValues(m[0])) out.add(v);
  }
  return out;
}

/** The value of a claim as `claims()` writes it: "2500", "25M", "2.5B", "100K", "5%". */
export function claimValue(n: string): number | null {
  const m = n.trim().match(/^(\d+(?:\.\d+)?)([kKmMbB])?[%+]*$/);
  if (!m) return null;
  const mult = m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase() as "k" | "m" | "b"] : 1;
  return Math.round(Number(m[1]) * mult * 1000) / 1000;
}

/** Whether the text states the claim's value in any of its forms. */
export function numberStatedIn(claim: string, text: string): boolean {
  const v = claimValue(claim);
  return v != null && numberValuesIn(text).has(v);
}
