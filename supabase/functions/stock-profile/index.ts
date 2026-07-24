// =============================================================================
// Supabase Edge Function: stock-profile
//
// Thin, read-only proxy that combines FMP's real-time quote + company profile
// for ONE ticker into a single normalized response, so the Public Market Hub's
// Stock Profile Modal can render price/valuation + company overview without
// the FMP key ever reaching the browser.
//
// Secrets: FMP_API_KEY (same secret sync-public-markets / search-tickers use).
// Deploy:  supabase functions deploy stock-profile --no-verify-jwt
// Invoke:  POST { "ticker": "ABNB" } → StockProfile (see shape below)
//
// Endpoints used:
//   /v3/quote/{ticker}          — legacy v3, confirmed still live (used by
//                                 sync-public-markets already).
//   /stable/profile?symbol=...  — profile is served from the newer /stable
//                                 surface (same reason search-tickers moved
//                                 off /v3/search: FMP retires legacy routes
//                                 endpoint-by-endpoint, not all at once).
// =============================================================================

const FMP_V3 = "https://financialmodelingprep.com/api/v3";
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

// "123.45-234.56" -> [123.45, 234.56]; tolerant of extra whitespace.
function parseRange(range: string | undefined | null): [number | null, number | null] {
  if (!range) return [null, null];
  const parts = range.split("-").map((p) => num(p.trim()));
  return [parts[0] ?? null, parts[1] ?? null];
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const FMP_KEY = Deno.env.get("FMP_API_KEY");
  if (!FMP_KEY) return json({ error: "FMP_API_KEY is not set (supabase secrets set FMP_API_KEY=...)" }, 500);

  let ticker = "";
  try {
    const body = await req.json();
    ticker = typeof body?.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  } catch {
    const url = new URL(req.url);
    ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  }
  if (!ticker) return json({ error: "Missing ticker" }, 400);

  try {
    const [quoteArr, profileArr] = await Promise.all([
      fetchJson<any[]>(`${FMP_V3}/quote/${ticker}?apikey=${FMP_KEY}`),
      fetchJson<any[]>(`${FMP_STABLE}/profile?symbol=${ticker}&apikey=${FMP_KEY}`),
    ]);
    const q = quoteArr?.[0] ?? null;
    const p = profileArr?.[0] ?? null;
    if (!q && !p) return json({ error: `No data found for "${ticker}"` }, 404);

    const [rangeLow, rangeHigh] = parseRange(p?.range);
    const price = num(q?.price) ?? num(p?.price);
    const lastDiv = num(p?.lastDiv);
    const dividendYieldPct = lastDiv && price && price > 0 ? Math.round((lastDiv / price) * 10000) / 100 : null;

    const profile = {
      ticker,
      name: q?.name ?? p?.companyName ?? ticker,
      exchange: q?.exchange ?? p?.exchangeShortName ?? null,
      currency: p?.currency ?? null,
      image: p?.image ?? null,
      website: p?.website ?? null,

      price,
      change: num(q?.change),
      changesPercentage: num(q?.changesPercentage),

      dayLow: num(q?.dayLow),
      dayHigh: num(q?.dayHigh),
      yearLow: num(q?.yearLow) ?? rangeLow,
      yearHigh: num(q?.yearHigh) ?? rangeHigh,

      marketCap: num(q?.marketCap) ?? num(p?.mktCap),
      pe: num(q?.pe),
      beta: num(p?.beta),
      avgVolume: num(q?.avgVolume) ?? num(p?.volAvg),
      volume: num(q?.volume),
      lastDividend: lastDiv,
      dividendYieldPct,

      description: p?.description ?? null,
      sector: p?.sector ?? null,
      industry: p?.industry ?? null,
      ceo: p?.ceo ?? null,
      city: p?.city ?? null,
      state: p?.state ?? null,
      country: p?.country ?? null,
    };

    return json({ profile });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "profile lookup failed" }, 500);
  }
});
