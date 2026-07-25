// =============================================================================
// Supabase Edge Function: stock-history
//
// Historical price series for ONE ticker, for the Public Market Hub's Stock
// Profile Modal price chart. Returns a normalized {t, c}[] series (timestamp
// ms, close price) so the frontend never needs to know any provider's shape.
//
// Secrets: FMP_API_KEY (same secret the other public-market functions use).
// Deploy:  supabase functions deploy stock-history --no-verify-jwt
// Invoke:  POST { "ticker": "ABNB", "range": "1M" }
//          -> { series: {t,c}[], source: "fmp" | "yahoo" }
//
// range one of: 1D | 1M | 3M | 1Y | 5Y | ALL
//
// ── Provider strategy ───────────────────────────────────────────────────────
// FMP is tried first. Two of its failure modes are invisible at the HTTP
// layer and both are handled here:
//
//   1. A gated response comes back HTTP 200 with a JSON *object* body
//      ({"Error Message": ...}) or with a bare text body, instead of an array.
//   2. Gating is PER SYMBOL, not per endpoint. Observed live: COIN returns a
//      full 3M series on this key while S returns
//        "Premium Query Parameter: 'Special Endpoint : This value set for
//         'symbol' is not available under your current subscription"
//      from the very same endpoint. So the fallback has to be decided per
//      request, not disabled globally.
//
// When FMP yields nothing — gated symbol, empty payload, transport error —
// we fall back to Yahoo Finance's chart endpoint, which needs no key and
// covers the symbols FMP restricts.
//
// CAVEAT: the Yahoo chart endpoint is undocumented/unofficial. It is widely
// used and keyless, but it can rate-limit or change shape without notice, so
// it is deliberately the fallback rather than the primary. If it starts
// failing, the diagnostic in the 404 response body will say so explicitly.
// =============================================================================

const FMP_STABLE = "https://financialmodelingprep.com/stable";
const FMP_V3 = "https://financialmodelingprep.com/api/v3";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const num = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : null);

const redact = (url: string) => url.replace(/apikey=[^&]*/i, "apikey=***");

type Range = "1D" | "1M" | "3M" | "1Y" | "5Y" | "ALL";
const RANGES: Range[] = ["1D", "1M", "3M", "1Y", "5Y", "ALL"];

interface Point { t: number; c: number; }

interface Attempt {
  url: string;
  status: number | null;
  bars: number;
  note?: string;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromDateFor(range: Range, to: Date): string {
  const from = new Date(to);
  switch (range) {
    case "1M": from.setDate(from.getDate() - 32); break;
    case "3M": from.setDate(from.getDate() - 95); break;
    case "1Y": from.setFullYear(from.getFullYear() - 1); from.setDate(from.getDate() - 5); break;
    case "5Y": from.setFullYear(from.getFullYear() - 5); break;
    case "ALL": from.setFullYear(1980); break;
    default: from.setDate(from.getDate() - 95);
  }
  return ymd(from);
}

// A 45-year ALL series is ~11k daily bars; the chart cannot resolve more than
// roughly a point per pixel, so thin it evenly. Always keeps first and last.
function downsample<T>(arr: T[], max = 800): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

// ── FMP ─────────────────────────────────────────────────────────────────────

function extractBars(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown> | null;
  if (o && Array.isArray(o.historical)) return o.historical as any[];
  return [];
}

function fmpMessage(raw: unknown): string | null {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const k of ["Error Message", "error message", "errorMessage", "error", "Information", "message"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * True when FMP is telling us this symbol/endpoint is not on the current
 * plan, rather than that the data genuinely does not exist. Matched loosely
 * because FMP has used several different wordings for the same condition.
 */
function isPlanGated(note: string | undefined): boolean {
  if (!note) return false;
  const n = note.toLowerCase();
  return (
    n.includes("premium") ||
    n.includes("subscription") ||
    n.includes("special endpoint") ||
    n.includes("exclusive endpoint") ||
    n.includes("legacy endpoint") ||
    n.includes("upgrade") ||
    n.includes("not available under")
  );
}

async function fetchFmp(urls: string[]): Promise<{ bars: any[]; attempts: Attempt[]; gated: boolean }> {
  const attempts: Attempt[] = [];
  let gated = false;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      let bars: any[] = [];
      let note: string | undefined;
      try {
        const data = JSON.parse(text);
        bars = extractBars(data);
        note = fmpMessage(data) ?? undefined;
      } catch {
        // A gated response is sometimes plain text rather than JSON — that is
        // exactly how the "Special Endpoint" restriction surfaced in testing.
        note = text.trim().slice(0, 160);
      }
      if (isPlanGated(note)) gated = true;
      attempts.push({ url: redact(url), status: res.status, bars: bars.length, note });
      if (bars.length > 0) return { bars, attempts, gated };
    } catch (e) {
      attempts.push({ url: redact(url), status: null, bars: 0, note: e instanceof Error ? e.message : "fetch threw" });
    }
  }
  return { bars: [], attempts, gated };
}

function fmpUrlsFor(ticker: string, range: Range, key: string): string[] {
  const to = new Date();
  const from = fromDateFor(range, to);
  const daily = [
    `${FMP_STABLE}/historical-price-eod/light?symbol=${ticker}&from=${from}&to=${ymd(to)}&apikey=${key}`,
    `${FMP_STABLE}/historical-price-eod/full?symbol=${ticker}&from=${from}&to=${ymd(to)}&apikey=${key}`,
    `${FMP_V3}/historical-price-full/${ticker}?from=${from}&to=${ymd(to)}&serietype=line&apikey=${key}`,
    `${FMP_V3}/historical-price-full/${ticker}?from=${from}&to=${ymd(to)}&apikey=${key}`,
  ];
  if (range !== "1D") return daily;
  return [
    `${FMP_STABLE}/historical-chart/5min?symbol=${ticker}&apikey=${key}`,
    `${FMP_STABLE}/historical-chart/1hour?symbol=${ticker}&apikey=${key}`,
    `${FMP_V3}/historical-chart/5min/${ticker}?apikey=${key}`,
    ...daily,
  ];
}

function fmpBarsToSeries(bars: any[]): Point[] {
  return bars
    .map((b) => ({ t: new Date(b.date).getTime(), c: num(b.close ?? b.price ?? b.adjClose) }))
    .filter((pt): pt is Point => pt.c != null && isFinite(pt.t))
    .sort((a, b) => a.t - b.t);
}

// ── Yahoo Finance fallback ──────────────────────────────────────────────────

/** Yahoo's own range/interval vocabulary for each of our timeframes. */
const YAHOO_PARAMS: Record<Range, { range: string; interval: string }> = {
  "1D":  { range: "1d",  interval: "5m"  },
  "1M":  { range: "1mo", interval: "1d"  },
  "3M":  { range: "3mo", interval: "1d"  },
  "1Y":  { range: "1y",  interval: "1d"  },
  "5Y":  { range: "5y",  interval: "1wk" },
  "ALL": { range: "max", interval: "1mo" },
};

async function fetchYahoo(ticker: string, range: Range): Promise<{ series: Point[]; attempt: Attempt }> {
  const { range: r, interval } = YAHOO_PARAMS[range];
  const url = `${YAHOO}/${encodeURIComponent(ticker)}?range=${r}&interval=${interval}`;
  try {
    // Yahoo 403s requests without a browser-like UA.
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlphaMap/1.0)", "Accept": "application/json" },
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return { series: [], attempt: { url, status: res.status, bars: 0, note: `non-JSON: ${text.slice(0, 120)}` } };
    }

    const err = data?.chart?.error;
    if (err) {
      const note = typeof err === "string" ? err : (err.description ?? err.code ?? JSON.stringify(err)).toString();
      return { series: [], attempt: { url, status: res.status, bars: 0, note: `yahoo error: ${note}` } };
    }

    const result = data?.chart?.result?.[0];
    const stamps: number[] = result?.timestamp ?? [];
    // adjclose is preferred for multi-year ranges (splits/dividends), with
    // raw close as the fallback when Yahoo omits the adjusted series.
    const closes: (number | null)[] =
      result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? [];

    const series: Point[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const c = num(closes[i]);
      const t = stamps[i] * 1000; // Yahoo timestamps are seconds
      // Yahoo pads holidays/halts with nulls — drop them rather than drawing
      // a line to zero.
      if (c != null && isFinite(t)) series.push({ t, c });
    }
    series.sort((a, b) => a.t - b.t);
    return { series, attempt: { url, status: res.status, bars: series.length } };
  } catch (e) {
    return {
      series: [],
      attempt: { url, status: null, bars: 0, note: e instanceof Error ? e.message : "fetch threw" },
    };
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const FMP_KEY = Deno.env.get("FMP_API_KEY");

  let ticker = "";
  let range: Range = "3M";
  try {
    const body = await req.json();
    ticker = typeof body?.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    if (typeof body?.range === "string" && (RANGES as string[]).includes(body.range)) range = body.range as Range;
  } catch {
    const url = new URL(req.url);
    ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
    const rq = url.searchParams.get("range");
    if (rq && (RANGES as string[]).includes(rq)) range = rq as Range;
  }
  if (!ticker) return json({ error: "Missing ticker" }, 400);

  try {
    const attempts: Attempt[] = [];
    let series: Point[] = [];
    let source: "fmp" | "yahoo" = "fmp";
    let gated = false;

    // 1) FMP first — it is the keyed, contractual provider.
    if (FMP_KEY) {
      const r = await fetchFmp(fmpUrlsFor(ticker, range, FMP_KEY));
      attempts.push(...r.attempts);
      gated = r.gated;
      series = fmpBarsToSeries(r.bars);

      // 1D from a daily fallback URL still returns daily bars; narrow to the
      // latest session only when we actually got intraday granularity.
      if (range === "1D" && series.length > 0) {
        const lastDay = new Date(series[series.length - 1].t).toISOString().slice(0, 10);
        const sameDay = series.filter((pt) => new Date(pt.t).toISOString().slice(0, 10) === lastDay);
        if (sameDay.length > 1) series = sameDay;
      }
    } else {
      attempts.push({ url: "(fmp skipped)", status: null, bars: 0, note: "FMP_API_KEY is not set" });
    }

    // 2) Yahoo fallback whenever FMP produced nothing — a plan-gated symbol
    //    is the common case, but an empty or failed response gets the same
    //    treatment so the chart still renders.
    if (series.length === 0) {
      const y = await fetchYahoo(ticker, range);
      attempts.push(y.attempt);
      if (y.series.length > 0) {
        series = y.series;
        source = "yahoo";
      }
    }

    if (series.length === 0) {
      const diagnostic = attempts
        .map((a) => `${a.url} -> status=${a.status} bars=${a.bars}${a.note ? ` note="${a.note}"` : ""}`)
        .join(" | ");
      console.error(`[stock-history] ${ticker} (${range}): no bars from any provider — ${diagnostic}`);
      return json(
        {
          error: `No historical data found for "${ticker}" (${range})`,
          gated,
          attempts,
        },
        404,
      );
    }

    if (gated && source === "yahoo") {
      // Not an error — worth a log line so the share of traffic being served
      // by the unofficial fallback is visible.
      console.log(`[stock-history] ${ticker} (${range}): FMP plan-gated, served ${series.length} bars from Yahoo.`);
    }

    return json({ series: downsample(series), source });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "history lookup failed" }, 500);
  }
});
