// =============================================================================
// Supabase Edge Function: stock-history
//
// Historical price series for ONE ticker, for the Public Market Hub's Stock
// Profile Modal price chart. Returns a normalized {t, c}[] series (timestamp
// ms, close price) so the frontend never needs to know FMP's response shape.
//
// Secrets: FMP_API_KEY (same secret the other public-market functions use).
// Deploy:  supabase functions deploy stock-history --no-verify-jwt
// Invoke:  POST { "ticker": "ABNB", "range": "1M" } → { series: {t,c}[] }
//
// range one of: 1D | 1M | 3M | 1Y | 5Y | ALL
//
// Endpoints tried (in order, first non-empty result wins):
//   Daily (every range except 1D):
//     /stable/historical-price-eod/full?symbol=...&from=&to=
//     /api/v3/historical-price-full/{ticker}?from=&to=      (legacy fallback)
//   Intraday (1D):
//     /stable/historical-chart/5min?symbol=...
//     /api/v3/historical-chart/5min/{ticker}                (legacy fallback)
//
// FMP has repeatedly changed endpoint availability and response shape
// between /v3 and /stable (see stock-profile, search-tickers) without
// notice, and response shape itself has drifted too — some surfaces wrap
// bars in {symbol, historical: [...]}, others return a bare array — so both
// are tried and both shapes are handled. Every attempt's HTTP status is
// logged when nothing yields data, so a future drift shows up in the
// function logs instead of another guess-and-redeploy round trip.
// =============================================================================

const FMP_STABLE = "https://financialmodelingprep.com/stable";
const FMP_V3 = "https://financialmodelingprep.com/api/v3";

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

interface Attempt {
  url: string;
  status: number | null;
  bars: number;
}

// FMP wraps daily-EOD history as {symbol, historical:[...]} on some surfaces
// and returns a bare array on others — accept either.
function extractBars(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.historical)) return raw.historical;
  return [];
}

// Tries each candidate URL in order (cheapest/most-likely first) and returns
// the first one that actually yields bars, along with a log of every attempt
// for diagnostics when all of them come up empty.
async function fetchFirstNonEmpty(urls: string[]): Promise<{ bars: any[]; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      let bars: any[] = [];
      if (res.ok) {
        const data = await res.json();
        bars = extractBars(data);
      }
      attempts.push({ url: url.replace(/apikey=[^&]+/, "apikey=***"), status: res.status, bars: bars.length });
      if (bars.length > 0) return { bars, attempts };
    } catch (e) {
      attempts.push({ url: url.replace(/apikey=[^&]+/, "apikey=***"), status: null, bars: 0 });
    }
  }
  return { bars: [], attempts };
}

type Range = "1D" | "1M" | "3M" | "1Y" | "5Y" | "ALL";
const RANGES: Range[] = ["1D", "1M", "3M", "1Y", "5Y", "ALL"];

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const FMP_KEY = Deno.env.get("FMP_API_KEY");
  if (!FMP_KEY) return json({ error: "FMP_API_KEY is not set (supabase secrets set FMP_API_KEY=...)" }, 500);

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
    let bars: any[];
    let attempts: Attempt[];
    let series: { t: number; c: number }[];

    if (range === "1D") {
      ({ bars, attempts } = await fetchFirstNonEmpty([
        `${FMP_STABLE}/historical-chart/5min?symbol=${ticker}&apikey=${FMP_KEY}`,
        `${FMP_V3}/historical-chart/5min/${ticker}?apikey=${FMP_KEY}`,
      ]));
      // FMP returns intraday bars newest-first across many trading days —
      // keep only the most recent trading day, then put them in chrono order.
      const latestDay = bars[0]?.date ? String(bars[0].date).slice(0, 10) : null;
      const todaysBars = latestDay ? bars.filter((b) => String(b.date).startsWith(latestDay)) : bars;
      series = todaysBars
        .map((b) => ({ t: new Date(b.date).getTime(), c: num(b.close) }))
        .filter((pt): pt is { t: number; c: number } => pt.c != null && isFinite(pt.t))
        .reverse();
    } else {
      const to = new Date();
      const from = fromDateFor(range, to);
      ({ bars, attempts } = await fetchFirstNonEmpty([
        `${FMP_STABLE}/historical-price-eod/full?symbol=${ticker}&from=${from}&to=${ymd(to)}&apikey=${FMP_KEY}`,
        `${FMP_V3}/historical-price-full/${ticker}?from=${from}&to=${ymd(to)}&apikey=${FMP_KEY}`,
      ]));
      series = bars
        .map((b) => ({ t: new Date(b.date).getTime(), c: num(b.close ?? b.adjClose) }))
        .filter((pt): pt is { t: number; c: number } => pt.c != null && isFinite(pt.t))
        .sort((a, b) => a.t - b.t);
    }

    if (series.length === 0) {
      console.error(
        `[stock-history] ${ticker} (${range}): no bars from any source — ` +
        attempts.map((a) => `${a.url} -> status=${a.status} bars=${a.bars}`).join(" | ")
      );
      return json({ error: `No historical data found for "${ticker}" (${range})` }, 404);
    }
    return json({ series });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "history lookup failed" }, 500);
  }
});
