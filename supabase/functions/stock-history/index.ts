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
// Endpoints used:
//   /stable/historical-chart/5min?symbol=...            — intraday, for 1D.
//   /stable/historical-price-eod/full?symbol=...&from=&to= — daily EOD bars,
//     for every other range. Response shape has drifted between FMP's /v3
//     (wrapped in {symbol, historical: [...]}) and /stable (often a bare
//     array) before, so both shapes are handled defensively.
// =============================================================================

const FMP_STABLE = "https://financialmodelingprep.com/stable";

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

async function fetchJson<T = any>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
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

// FMP wraps daily-EOD history as {symbol, historical:[...]} on some surfaces
// and returns a bare array on others — accept either.
function extractBars(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.historical)) return raw.historical;
  return [];
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
    let series: { t: number; c: number }[];

    if (range === "1D") {
      const bars = (await fetchJson<any[]>(`${FMP_STABLE}/historical-chart/5min?symbol=${ticker}&apikey=${FMP_KEY}`)) ?? [];
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
      const raw = await fetchJson<any>(
        `${FMP_STABLE}/historical-price-eod/full?symbol=${ticker}&from=${from}&to=${ymd(to)}&apikey=${FMP_KEY}`
      );
      const bars = extractBars(raw);
      series = bars
        .map((b) => ({ t: new Date(b.date).getTime(), c: num(b.close ?? b.adjClose) }))
        .filter((pt): pt is { t: number; c: number } => pt.c != null && isFinite(pt.t))
        .sort((a, b) => a.t - b.t);
    }

    if (series.length === 0) return json({ error: `No historical data found for "${ticker}" (${range})` }, 404);
    return json({ series });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "history lookup failed" }, 500);
  }
});
