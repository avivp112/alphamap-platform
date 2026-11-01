/**
 * lib/enrichment/currency.ts — a round's amount in the currency its source
 * states (owner, 2026-11-01). Helsing's "€102.5 million" Series A was written
 * as $100M and its €600M Series D as $600M: the extraction schema asks for
 * USD, so a euro figure went in as if it were dollars. Now:
 *
 *   - the currency is read from the amount's own quote, next to the figure
 *     ("€102.5 million", "£40m", "CHF 20 million", "Rs 700 crore" is not read);
 *   - funding_rounds.amount_raised holds the USD estimate (totals, charts,
 *     comparisons), at the year's average rate below — an estimate;
 *   - amount_original / amount_currency keep what the source says, and the
 *     site shows both: "€102.5M (~$116M)".
 *
 * A currency without a rate here is not converted: the round keeps its
 * original figure and no USD amount (never a guessed rate). Pure.
 */

export type Currency = "USD" | "EUR" | "GBP" | "CHF" | "INR" | "ILS" | "JPY" | "CAD" | "AUD" | "SEK";

// USD for one unit, yearly average (ECB / Federal Reserve H.10 annual
// averages, rounded). An estimate: the round's own day may differ by a few percent.
const USD_PER_UNIT: Partial<Record<Currency, Record<number, number>>> = {
  EUR: { 2010: 1.33, 2011: 1.39, 2012: 1.29, 2013: 1.33, 2014: 1.33, 2015: 1.11, 2016: 1.11, 2017: 1.13, 2018: 1.18, 2019: 1.12, 2020: 1.14, 2021: 1.18, 2022: 1.05, 2023: 1.08, 2024: 1.08, 2025: 1.13, 2026: 1.16 },
  GBP: { 2010: 1.55, 2011: 1.60, 2012: 1.58, 2013: 1.56, 2014: 1.65, 2015: 1.53, 2016: 1.36, 2017: 1.29, 2018: 1.34, 2019: 1.28, 2020: 1.28, 2021: 1.38, 2022: 1.24, 2023: 1.24, 2024: 1.28, 2025: 1.32, 2026: 1.34 },
  CHF: { 2010: 0.96, 2011: 1.13, 2012: 1.07, 2013: 1.08, 2014: 1.09, 2015: 1.04, 2016: 1.02, 2017: 1.02, 2018: 1.02, 2019: 1.01, 2020: 1.07, 2021: 1.09, 2022: 1.05, 2023: 1.11, 2024: 1.14, 2025: 1.20, 2026: 1.24 },
  INR: { 2010: 1 / 45.7, 2011: 1 / 46.7, 2012: 1 / 53.4, 2013: 1 / 58.6, 2014: 1 / 61.0, 2015: 1 / 64.2, 2016: 1 / 67.2, 2017: 1 / 65.1, 2018: 1 / 68.4, 2019: 1 / 70.4, 2020: 1 / 74.1, 2021: 1 / 73.9, 2022: 1 / 78.6, 2023: 1 / 82.6, 2024: 1 / 83.7, 2025: 1 / 86.5, 2026: 1 / 88.0 },
  ILS: { 2010: 1 / 3.73, 2011: 1 / 3.58, 2012: 1 / 3.86, 2013: 1 / 3.61, 2014: 1 / 3.58, 2015: 1 / 3.88, 2016: 1 / 3.84, 2017: 1 / 3.60, 2018: 1 / 3.59, 2019: 1 / 3.56, 2020: 1 / 3.44, 2021: 1 / 3.23, 2022: 1 / 3.36, 2023: 1 / 3.69, 2024: 1 / 3.70, 2025: 1 / 3.55, 2026: 1 / 3.45 },
  CAD: { 2010: 0.97, 2011: 1.01, 2012: 1.00, 2013: 0.97, 2014: 0.91, 2015: 0.78, 2016: 0.76, 2017: 0.77, 2018: 0.77, 2019: 0.75, 2020: 0.75, 2021: 0.80, 2022: 0.77, 2023: 0.74, 2024: 0.73, 2025: 0.72, 2026: 0.73 },
  AUD: { 2010: 0.92, 2011: 1.03, 2012: 1.04, 2013: 0.97, 2014: 0.90, 2015: 0.75, 2016: 0.74, 2017: 0.77, 2018: 0.75, 2019: 0.70, 2020: 0.69, 2021: 0.75, 2022: 0.69, 2023: 0.66, 2024: 0.66, 2025: 0.65, 2026: 0.66 },
  SEK: { 2010: 1 / 7.20, 2011: 1 / 6.49, 2012: 1 / 6.77, 2013: 1 / 6.51, 2014: 1 / 6.86, 2015: 1 / 8.43, 2016: 1 / 8.56, 2017: 1 / 8.54, 2018: 1 / 8.69, 2019: 1 / 9.46, 2020: 1 / 9.21, 2021: 1 / 8.58, 2022: 1 / 10.11, 2023: 1 / 10.61, 2024: 1 / 10.57, 2025: 1 / 10.0, 2026: 1 / 9.6 },
  JPY: { 2010: 1 / 87.8, 2011: 1 / 79.7, 2012: 1 / 79.8, 2013: 1 / 97.6, 2014: 1 / 105.9, 2015: 1 / 121.0, 2016: 1 / 108.8, 2017: 1 / 112.2, 2018: 1 / 110.4, 2019: 1 / 109.0, 2020: 1 / 106.8, 2021: 1 / 109.8, 2022: 1 / 131.5, 2023: 1 / 140.5, 2024: 1 / 151.4, 2025: 1 / 149.0, 2026: 1 / 150.0 },
};

const MARKERS: Array<[Currency, RegExp, RegExp]> = [
  // [currency, before the figure, after the figure]
  ["EUR", /(€|\bEUR|\beuros?)\s?$/i, /^\s?(million|billion|mn|bn|m|b|k)?\s*(euros?\b|EUR\b)/i],
  ["GBP", /(£|\bGBP)\s?$/i, /^\s?(million|billion|mn|bn|m|b|k)?\s*(pounds?( sterling)?\b|GBP\b)/i],
  ["CHF", /\bCHF\s?$/, /^\s?(million|billion|mn|bn|m|b|k)?\s*(Swiss francs?\b|CHF\b)/i],
  ["INR", /(₹|\bINR|\bRs\.?)\s?$/, /^\s?(million|billion|mn|bn|m|b|k)?\s*(rupees?\b|INR\b)/i],
  ["ILS", /(₪|\bNIS|\bILS)\s?$/, /^\s?(million|billion|mn|bn|m|b|k)?\s*(shekels?\b|NIS\b|ILS\b)/i],
  ["JPY", /(¥|\bJPY)\s?$/, /^\s?(million|billion|mn|bn|m|b|k)?\s*(yen\b|JPY\b)/i],
  ["CAD", /(C\$|\bCAD)\s?$/, /^\s?(million|billion|mn|bn|m|b|k)?\s*(Canadian dollars?\b|CAD\b)/i],
  ["AUD", /(A\$|\bAUD)\s?$/, /^\s?(million|billion|mn|bn|m|b|k)?\s*(Australian dollars?\b|AUD\b)/i],
  ["SEK", /\bSEK\s?$/, /^\s?(million|billion|mn|bn|m|b|k)?\s*(kronor\b|SEK\b)/i],
];

const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, mn: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9 };
const FIGURE = /(\d[\d,]*\.?\d*)\s*(thousand|million|billion|mn|bn|k|m|b)?\b/gi;

/**
 * The currency the quote writes `amount` in: the marker right before or after
 * the figure that equals it. USD when the figure has "$" / "US$" / "USD" or no
 * marker at all (the convention of the sources read); null when the figure is
 * not in the quote.
 */
export function currencyOfAmount(amount: number, quote: string | null | undefined): Currency | null {
  if (!quote || !(amount > 0)) return null;
  for (const m of quote.matchAll(FIGURE)) {
    const value = parseFloat(m[1].replace(/,/g, "")) * (m[2] ? SCALE[m[2].toLowerCase()] ?? 1 : 1);
    if (Math.abs(value - amount) / amount > 0.005) continue;
    const before = quote.slice(Math.max(0, m.index! - 6), m.index!);
    const after = quote.slice(m.index! + m[1].length, m.index! + m[0].length + 24);
    if (/(US\$|\bUSD)\s?$/i.test(before)) return "USD";
    for (const [cur, pre, post] of MARKERS) if (pre.test(before) || post.test(after)) return cur;
    return "USD";
  }
  return null;
}

/** The USD estimate of an amount in `currency` in `year` (the latest known year's rate after it); null without a rate. */
export function toUsd(amount: number, currency: Currency, year: number | null): number | null {
  if (currency === "USD") return amount;
  const table = USD_PER_UNIT[currency];
  if (!table) return null;
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  const y = year == null ? years[years.length - 1] : Math.min(Math.max(year, years[0]), years[years.length - 1]);
  return Math.round(amount * table[y]);
}

const SYMBOL: Partial<Record<Currency, string>> = { EUR: "€", GBP: "£", INR: "₹", ILS: "₪", JPY: "¥" };

/** "€102.5M", "CHF 20M" — the source's own figure, short. */
export function formatOriginal(amount: number, currency: string): string {
  const sym = SYMBOL[currency as Currency];
  const short = amount >= 1e9 ? `${+(amount / 1e9).toFixed(2)}B` : amount >= 1e6 ? `${+(amount / 1e6).toFixed(1)}M` : amount >= 1e3 ? `${+(amount / 1e3).toFixed(0)}K` : String(amount);
  return sym ? `${sym}${short}` : `${currency} ${short}`;
}
