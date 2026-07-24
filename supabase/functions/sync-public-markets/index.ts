// =============================================================================
// Supabase Edge Function: sync-public-markets
//
// Pulls fresh market metrics from Financial Modeling Prep (FMP) and upserts
// them into the `public_companies` table on the unique `ticker` key. Serves
// two modes from the same function:
//
//   1. Daily full sync (no body, or {}) — refreshes the curated 19-ticker
//      universe (Cyber/SaaS/Fintech/AI). This is what the cron schedule calls.
//   2. On-demand single/multi-ticker sync ({ "tickers": ["ABNB", ...] }) — the
//      Public Market Hub's stock search bar calls this with exactly the ticker
//      the user picked. Tickers outside the curated universe get their
//      name/sector/exchange resolved from FMP's company profile endpoint (sector
//      mapped to cyber/saas/fintech/ai/other via keywords — approximate, since
//      there's no clean GICS→our-4-buckets mapping; "other" tickers still land
//      in the companies directory, just outside the Sector Matrix/Sentiment).
//
// Secrets / env (set with `supabase secrets set`, NEVER committed):
//   FMP_API_KEY                 — your Financial Modeling Prep key
//   SUPABASE_URL                — auto-injected by the Edge runtime
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected by the Edge runtime
//
// Deploy:  supabase functions deploy sync-public-markets --no-verify-jwt
// Invoke:  POST https://<project-ref>.supabase.co/functions/v1/sync-public-markets
//          POST .../sync-public-markets  body: {"tickers":["ABNB"]}
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FMP = "https://financialmodelingprep.com/api/v3";

type Sector = "cyber" | "saas" | "fintech" | "ai" | "other";
interface Meta { ticker: string; name: string; sector: Sector; hint: string | null; exchange: string | null }

// Curated universe — the daily cron target. Keep sector values in sync with
// PUBLIC_SECTORS on the client (cyber | saas | fintech | ai).
const UNIVERSE: Meta[] = [
  { ticker: "CRWD", name: "CrowdStrike",        sector: "cyber",   hint: "Wiz",                 exchange: "NASDAQ" },
  { ticker: "PANW", name: "Palo Alto Networks", sector: "cyber",   hint: "Snyk",                 exchange: "NASDAQ" },
  { ticker: "ZS",   name: "Zscaler",            sector: "cyber",   hint: "Netskope",             exchange: "NASDAQ" },
  { ticker: "FTNT", name: "Fortinet",           sector: "cyber",   hint: null,                   exchange: "NASDAQ" },
  { ticker: "S",    name: "SentinelOne",        sector: "cyber",   hint: "Abnormal Security",    exchange: "NYSE" },
  { ticker: "NOW",  name: "ServiceNow",         sector: "saas",    hint: null,                   exchange: "NYSE" },
  { ticker: "DDOG", name: "Datadog",            sector: "saas",    hint: "Grafana Labs",         exchange: "NASDAQ" },
  { ticker: "SNOW", name: "Snowflake",          sector: "saas",    hint: "Databricks",           exchange: "NYSE" },
  { ticker: "MDB",  name: "MongoDB",            sector: "saas",    hint: "Cockroach Labs",       exchange: "NASDAQ" },
  { ticker: "GTLB", name: "GitLab",             sector: "saas",    hint: null,                   exchange: "NASDAQ" },
  { ticker: "PYPL", name: "PayPal",             sector: "fintech", hint: "Stripe",               exchange: "NASDAQ" },
  { ticker: "COIN", name: "Coinbase",           sector: "fintech", hint: "Kraken",               exchange: "NASDAQ" },
  { ticker: "XYZ",  name: "Block",              sector: "fintech", hint: "Brex",                 exchange: "NYSE" },
  { ticker: "AFRM", name: "Affirm",             sector: "fintech", hint: "Klarna",               exchange: "NASDAQ" },
  { ticker: "NU",   name: "Nu Holdings",        sector: "fintech", hint: null,                   exchange: "NYSE" },
  { ticker: "NVDA", name: "NVIDIA",             sector: "ai",      hint: "Cerebras",             exchange: "NASDAQ" },
  { ticker: "PLTR", name: "Palantir",           sector: "ai",      hint: "Scale AI",             exchange: "NYSE" },
  { ticker: "ARM",  name: "Arm Holdings",       sector: "ai",      hint: "SiFive",               exchange: "NASDAQ" },
  { ticker: "AI",   name: "C3.ai",              sector: "ai",      hint: "Anthropic",            exchange: "NYSE" },
];
const UNIVERSE_BY_TICKER = new Map(UNIVERSE.map((u) => [u.ticker, u]));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const num = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : null);
const toMillions = (v: number | null): number | null => (v == null ? null : Math.round((v / 1e6) * 100) / 100);
const round = (v: number | null, dp = 2): number | null =>
  v == null || !isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fmtJson<T = any>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// 1-year momentum from FMP's stock-price-change endpoint (object or [object]).
function momentumFrom(chg: any): number | null {
  const o = Array.isArray(chg) ? chg[0] : chg;
  if (!o) return null;
  return num(o["1Y"]) ?? num(o["6M"]) ?? num(o["ytd"]) ?? null;
}

// Approximate GICS sector/industry → our 4 curated buckets. No clean mapping
// exists (there's no "AI" GICS sector), so this is intentionally a rough
// keyword heuristic — good enough for bucketing an ad-hoc search result into
// the companies directory; "other" is the honest fallback, not a bug.
function mapSector(sector: string | null, industry: string | null): Sector {
  const s = `${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  if (s.includes("security")) return "cyber";
  if (s.includes("software") || s.includes("information technology services")) return "saas";
  if (s.includes("semiconductor")) return "ai";
  if (
    s.includes("bank") || s.includes("insurance") || s.includes("credit") ||
    s.includes("capital markets") || s.includes("asset management") ||
    s.includes("financial data") || s.includes("financial services")
  ) return "fintech";
  return "other";
}

// Profile lookup uses the newer /stable surface — FMP has been retiring
// legacy /v3 endpoints one at a time (this is what broke /v3/search, see
// search-tickers/index.ts), and /stable/profile is the documented successor.
async function resolveAdHocMeta(ticker: string, fmpKey: string): Promise<Meta> {
  const profile = (await fmtJson<any[]>(`https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${fmpKey}`))?.[0] ?? null;
  return {
    ticker,
    name: profile?.companyName ?? ticker,
    sector: mapSector(profile?.sector ?? null, profile?.industry ?? null),
    hint: null,
    exchange: profile?.exchangeShortName ?? profile?.exchange ?? null,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const FMP_KEY = Deno.env.get("FMP_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!FMP_KEY) return json({ error: "FMP_API_KEY is not set (supabase secrets set FMP_API_KEY=...)" }, 500);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Parse optional { tickers: string[] } body for on-demand mode. Any parse
  // failure (including an empty/absent body) falls back to the full daily sync.
  let requestedTickers: string[] | null = null;
  try {
    const body = await req.json();
    if (Array.isArray(body?.tickers) && body.tickers.length > 0) {
      requestedTickers = [...new Set(body.tickers.map((t: unknown) => String(t).toUpperCase().trim()).filter(Boolean))].slice(0, 10);
    }
  } catch {
    /* no/invalid body → full daily sync */
  }

  const targets: Meta[] = requestedTickers
    ? await Promise.all(requestedTickers.map((t) => UNIVERSE_BY_TICKER.get(t) ?? resolveAdHocMeta(t, FMP_KEY)))
    : UNIVERSE;

  // Batch quote (market cap) for every target ticker in one call.
  const symbols = targets.map((t) => t.ticker).join(",");
  const quotes = symbols ? (await fmtJson<any[]>(`${FMP}/quote/${symbols}?apikey=${FMP_KEY}`)) ?? [] : [];
  const quoteBy = new Map<string, any>(quotes.map((q) => [q.symbol, q]));

  const syncedAt = new Date().toISOString();
  const results: { ticker: string; ok: boolean; error?: string }[] = [];

  for (const u of targets) {
    try {
      const q = quoteBy.get(u.ticker);
      // Per-ticker fundamentals (each guarded — premium-gated endpoints just
      // return null and we fall back to whatever else is available).
      const km = (await fmtJson<any[]>(`${FMP}/key-metrics-ttm/${u.ticker}?apikey=${FMP_KEY}`))?.[0] ?? null;
      const incQ = (await fmtJson<any[]>(`${FMP}/income-statement/${u.ticker}?period=quarter&limit=4&apikey=${FMP_KEY}`)) ?? [];
      const grow = (await fmtJson<any[]>(`${FMP}/income-statement-growth/${u.ticker}?limit=1&apikey=${FMP_KEY}`))?.[0] ?? null;
      const chg = await fmtJson(`${FMP}/stock-price-change/${u.ticker}?apikey=${FMP_KEY}`);

      const marketCap = num(q?.marketCap);
      // TTM revenue / EBITDA: prefer summing the last 4 reported quarters.
      const ttmRevenueAbs = incQ.length
        ? incQ.reduce((s, r) => s + (num(r.revenue) ?? 0), 0)
        : num(km?.revenuePerShareTTM) != null && num(q?.sharesOutstanding) != null
        ? (num(km.revenuePerShareTTM)! * num(q!.sharesOutstanding)!)
        : null;
      const ttmEbitdaAbs = incQ.length && incQ.some((r) => num(r.ebitda) != null)
        ? incQ.reduce((s, r) => s + (num(r.ebitda) ?? 0), 0)
        : null;

      let enterpriseValueAbs = num(km?.enterpriseValueTTM);
      if (enterpriseValueAbs == null && marketCap != null) enterpriseValueAbs = marketCap; // approx (no net debt available)

      let evRevenue = num(km?.evToSalesTTM);
      if (evRevenue == null && enterpriseValueAbs != null && ttmRevenueAbs && ttmRevenueAbs > 0) {
        evRevenue = enterpriseValueAbs / ttmRevenueAbs;
      }
      let evEbitda = num(km?.enterpriseValueOverEBITDATTM);
      if (evEbitda == null && enterpriseValueAbs != null && ttmEbitdaAbs && ttmEbitdaAbs > 0) {
        evEbitda = enterpriseValueAbs / ttmEbitdaAbs;
      }
      if (evEbitda != null && evEbitda <= 0) evEbitda = null; // don't store nonsensical negatives

      const yoyGrowthPct = grow?.growthRevenue != null ? round(num(grow.growthRevenue)! * 100, 1) : null;
      const momentumPct = round(momentumFrom(chg), 1);

      // Only include numeric fields we actually resolved, so a transient FMP
      // gap never overwrites a good prior value with NULL. Metadata is always
      // written so a first-run insert is complete.
      const row: Record<string, unknown> = {
        ticker: u.ticker, name: u.name, sector: u.sector, private_comp_hint: u.hint,
        exchange: u.exchange, synced_at: syncedAt,
      };
      const set = (k: string, v: number | null) => { if (v != null) row[k] = v; };
      set("market_cap", toMillions(marketCap));
      set("enterprise_value", toMillions(enterpriseValueAbs));
      set("ttm_revenue", toMillions(ttmRevenueAbs));
      set("ttm_ebitda", toMillions(ttmEbitdaAbs));
      set("ev_revenue", round(evRevenue));
      set("ev_ebitda", round(evEbitda));
      set("yoy_growth_pct", yoyGrowthPct);
      set("momentum_pct", momentumPct);

      const { error } = await supabase.from("public_companies").upsert(row, { onConflict: "ticker" });
      if (error) throw new Error(error.message);
      results.push({ ticker: u.ticker, ok: true });
    } catch (e) {
      results.push({ ticker: u.ticker, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    await sleep(120); // be gentle on FMP rate limits
  }

  const okCount = results.filter((r) => r.ok).length;
  return json({
    mode: requestedTickers ? "on-demand" : "full",
    synced_at: syncedAt, total: targets.length, ok: okCount, failed: targets.length - okCount, results,
  });
});
