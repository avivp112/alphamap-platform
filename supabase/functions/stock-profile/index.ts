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
//   /stable/quote?symbol=...       — the legacy single-ticker /v3/quote/{t}
//                                    path is retired; this is its /stable
//                                    replacement. Some fields (e.g. pe) only
//                                    ever lived here, not in profile.
//   /stable/profile?symbol=...     — FMP's /stable profile redesign folded
//                                    several old quote-only fields straight
//                                    into profile under NEW names (mktCap ->
//                                    marketCap, volAvg -> averageVolume,
//                                    lastDiv -> lastDividend, changesPercentage
//                                    -> changePercentage). We read both the
//                                    old and new names defensively since FMP's
//                                    docs and actual responses have drifted
//                                    before (see search-tickers, this file's
//                                    own quote-endpoint history).
//   /stable/ratios-ttm?symbol=...  — best-effort fallback for P/E and dividend
//                                    yield when quote doesn't carry them.
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

// Tries each candidate value in order (across both the quote and profile
// objects, whichever field name FMP actually used) and returns the first
// that parses as a number.
function pick(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = num(v);
    if (n != null) return n;
  }
  return null;
}

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
    const [quoteArr, profileArr, ratiosArr] = await Promise.all([
      fetchJson<any[]>(`${FMP_STABLE}/quote?symbol=${ticker}&apikey=${FMP_KEY}`),
      fetchJson<any[]>(`${FMP_STABLE}/profile?symbol=${ticker}&apikey=${FMP_KEY}`),
      fetchJson<any[]>(`${FMP_STABLE}/ratios-ttm?symbol=${ticker}&apikey=${FMP_KEY}`),
    ]);
    const q = quoteArr?.[0] ?? null;
    const p = profileArr?.[0] ?? null;
    const r = ratiosArr?.[0] ?? null;
    if (!q && !p) return json({ error: `No data found for "${ticker}"` }, 404);

    const [rangeLow, rangeHigh] = parseRange(p?.range ?? p?.priceRange);
    const price = pick(q?.price, p?.price);
    const marketCap = pick(q?.marketCap, q?.mktCap, p?.marketCap, p?.mktCap);
    const avgVolume = pick(q?.avgVolume, q?.averageVolume, p?.averageVolume, p?.volAvg, p?.avgVolume);
    const pe = pick(q?.pe, q?.peRatio, q?.priceEarningsRatio, r?.priceToEarningsRatioTTM, r?.peRatioTTM);
    const lastDiv = pick(p?.lastDividend, p?.lastDiv);
    const dividendYieldPct =
      pick(r?.dividendYieldTTM) != null
        ? Math.round((r!.dividendYieldTTM as number) * 10000) / 100
        : lastDiv && price && price > 0
        ? Math.round((lastDiv / price) * 10000) / 100
        : null;

    // A quote/profile field-name drift has bitten this endpoint before
    // (FMP renames fields between /v3 and /stable without notice) — logging
    // the raw keys whenever a metric comes back empty means the next drift
    // shows up in the function logs instead of another guess-and-redeploy
    // round trip.
    if (marketCap == null || pe == null || avgVolume == null) {
      console.error(
        `[stock-profile] ${ticker}: missing metric(s) — marketCap=${marketCap} pe=${pe} avgVolume=${avgVolume}. ` +
        `quote keys: ${q ? Object.keys(q).join(",") : "(no quote)"} | ` +
        `profile keys: ${p ? Object.keys(p).join(",") : "(no profile)"} | ` +
        `ratios keys: ${r ? Object.keys(r).join(",") : "(no ratios)"}`
      );
    }

    const profile = {
      ticker,
      name: q?.name ?? p?.companyName ?? ticker,
      exchange: q?.exchange ?? p?.exchangeShortName ?? p?.exchange ?? null,
      currency: p?.currency ?? null,
      image: p?.image ?? null,
      website: p?.website ?? null,

      price,
      change: pick(q?.change, p?.change),
      changesPercentage: pick(q?.changesPercentage, q?.changePercentage, p?.changePercentage, p?.changesPercentage),

      dayLow: pick(q?.dayLow, p?.dayLow),
      dayHigh: pick(q?.dayHigh, p?.dayHigh),
      yearLow: pick(q?.yearLow, p?.yearLow) ?? rangeLow,
      yearHigh: pick(q?.yearHigh, p?.yearHigh) ?? rangeHigh,

      marketCap,
      pe,
      beta: num(p?.beta),
      avgVolume,
      volume: pick(q?.volume, p?.volume),
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
