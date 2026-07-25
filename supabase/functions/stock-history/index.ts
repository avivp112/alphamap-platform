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
// ── Why this file tries so many endpoints ───────────────────────────────────
// FMP gates endpoints by plan AND has migrated /api/v3 -> /stable piecemeal.
// Two failure modes matter and neither is an HTTP error:
//
//   1. A plan-gated endpoint returns HTTP 200 with a JSON *object* body like
//      {"Error Message": "..."} or {"Information": "..."} instead of an array.
//      Treating that as "no data" hides the real cause, so we detect it and
//      surface FMP's own wording to the caller.
//   2. historical-price-eod/full and the intraday historical-chart routes are
//      premium on lower tiers, while historical-price-eod/light is not — so
//      /light is tried FIRST for daily data.
//
// Field names differ per variant: /light uses `price`, /full uses `close`,
// v3's historical-price-full nests bars under `historical`. All are handled.
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

const redact = (url: string) => url.replace(/apikey=[^&]*/i, "apikey=***");

interface Attempt {
  url: string;
  status: number | null;
  bars: number;
  note?: string; // FMP's own error wording, or a parse problem
}

// FMP wraps daily-EOD history as {symbol, historical:[...]} on some surfaces
// and returns a bare array on others — accept either.
function extractBars(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown> | null;
  if (o && Array.isArray(o.historical)) return o.historical as any[];
  return [];
}

// FMP signals plan/auth problems in a 200 JSON object rather than an HTTP
// status. Pull out whatever human-readable message it used.
function fmpMessage(raw: unknown): string | null {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const k of ["Error Message", "error message", "errorMessage", "error", "Information", "message"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Tries each candidate URL in order and returns the first that actually yields
// bars, plus a log of every attempt for diagnostics when all come up empty.
async function fetchFirstNonEmpty(urls: string[]): Promise<{ bars: any[]; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      let bars: any[] = [];
      let note: string | undefined;
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        bars = extractBars(data);
        note = fmpMessage(data) ?? undefined;
      } catch {
        note = `non-JSON response: ${text.slice(0, 120)}`;
      }
      attempts.push({ url: redact(url), status: res.status, bars: bars.length, note });
      if (bars.length > 0) return { bars, attempts };
    } catch (e) {
      attempts.push({
        url: redact(url),
        status: null,
        bars: 0,
        note: e instanceof Error ? e.message : "fetch threw",
      });
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

// A 45-year ALL series is ~11k daily bars; the chart can't resolve more than
// roughly a point per pixel, so thin it out evenly to keep the payload and
// the client-side render small. Always keeps the first and last bar.
function downsample<T>(arr: T[], max = 800): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
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
    const to = new Date();
    const from = fromDateFor(range, to);

    // /light is listed first deliberately: it is the variant available on the
    // lowest FMP tiers, and it carries everything the chart needs (date+price).
    const dailyUrls = [
      `${FMP_STABLE}/historical-price-eod/light?symbol=${ticker}&from=${from}&to=${ymd(to)}&apikey=${FMP_KEY}`,
      `${FMP_STABLE}/historical-price-eod/full?symbol=${ticker}&from=${from}&to=${ymd(to)}&apikey=${FMP_KEY}`,
      `${FMP_V3}/historical-price-full/${ticker}?from=${from}&to=${ymd(to)}&serietype=line&apikey=${FMP_KEY}`,
      `${FMP_V3}/historical-price-full/${ticker}?from=${from}&to=${ymd(to)}&apikey=${FMP_KEY}`,
    ];
    const intradayUrls = [
      `${FMP_STABLE}/historical-chart/5min?symbol=${ticker}&apikey=${FMP_KEY}`,
      `${FMP_STABLE}/historical-chart/1hour?symbol=${ticker}&apikey=${FMP_KEY}`,
      `${FMP_V3}/historical-chart/5min/${ticker}?apikey=${FMP_KEY}`,
    ];

    // Intraday is the most heavily plan-gated surface, so 1D degrades to the
    // daily series rather than showing an error when it isn't available.
    const { bars, attempts } = await fetchFirstNonEmpty(
      range === "1D" ? [...intradayUrls, ...dailyUrls] : dailyUrls,
    );

    // Every variant labels the close differently (see header comment).
    let series = bars
      .map((b) => ({ t: new Date(b.date).getTime(), c: num(b.close ?? b.price ?? b.adjClose) }))
      .filter((pt): pt is { t: number; c: number } => pt.c != null && isFinite(pt.t))
      .sort((a, b) => a.t - b.t);

    // For 1D, narrow an intraday feed to just the latest trading day. If we
    // fell through to daily bars there is nothing to narrow — leave as is.
    if (range === "1D" && series.length > 0) {
      const lastDay = new Date(series[series.length - 1].t).toISOString().slice(0, 10);
      const sameDay = series.filter((pt) => new Date(pt.t).toISOString().slice(0, 10) === lastDay);
      if (sameDay.length > 1) series = sameDay;
    }

    if (series.length === 0) {
      const diagnostic = attempts
        .map((a) => `${a.url} -> status=${a.status} bars=${a.bars}${a.note ? ` note="${a.note}"` : ""}`)
        .join(" | ");
      console.error(`[stock-history] ${ticker} (${range}): no bars from any source — ${diagnostic}`);
      // Surface FMP's own wording (e.g. a plan restriction) instead of a
      // generic miss — otherwise the cause is invisible from the browser.
      const fmpNote = attempts.find((a) => a.note)?.note;
      return json(
        {
          error: fmpNote
            ? `FMP: ${fmpNote}`
            : `No historical data found for "${ticker}" (${range})`,
          attempts,
        },
        404,
      );
    }

    return json({ series: downsample(series) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "history lookup failed" }, 500);
  }
});
