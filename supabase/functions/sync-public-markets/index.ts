// =============================================================================
// Supabase Edge Function: sync-public-markets
//
// Pulls fresh market metrics for the tracked public-company universe from
// Financial Modeling Prep (FMP) and upserts them into the `public_companies`
// table on the unique `ticker` key. Meant to run once a day (see README for
// pg_cron / GitLab schedule / dashboard-cron options) so the Public Market Hub
// always reads up-to-date figures straight from the database.
//
// Secrets / env (set with `supabase secrets set`, NEVER committed):
//   FMP_API_KEY                 — your Financial Modeling Prep key
//   SUPABASE_URL                — auto-injected by the Edge runtime
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected by the Edge runtime
//
// Deploy:  supabase functions deploy sync-public-markets --no-verify-jwt
// Invoke:  POST https://<project-ref>.supabase.co/functions/v1/sync-public-markets
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FMP = "https://financialmodelingprep.com/api/v3";

// Curated universe — ticker → metadata. The sync fills in the market numbers;
// name / sector / private_comp_hint are stable metadata written on every run so
// a first-run insert is complete. Keep this in sync with PUBLIC_SECTORS on the
// client (cyber | saas | fintech | ai).
type Sector = "cyber" | "saas" | "fintech" | "ai";
interface Meta { ticker: string; name: string; sector: Sector; hint: string | null }

const UNIVERSE: Meta[] = [
  { ticker: "CRWD", name: "CrowdStrike",        sector: "cyber",   hint: "Wiz" },
  { ticker: "PANW", name: "Palo Alto Networks", sector: "cyber",   hint: "Snyk" },
  { ticker: "ZS",   name: "Zscaler",            sector: "cyber",   hint: "Netskope" },
  { ticker: "FTNT", name: "Fortinet",           sector: "cyber",   hint: null },
  { ticker: "S",    name: "SentinelOne",        sector: "cyber",   hint: "Abnormal Security" },
  { ticker: "NOW",  name: "ServiceNow",         sector: "saas",    hint: null },
  { ticker: "DDOG", name: "Datadog",            sector: "saas",    hint: "Grafana Labs" },
  { ticker: "SNOW", name: "Snowflake",          sector: "saas",    hint: "Databricks" },
  { ticker: "MDB",  name: "MongoDB",            sector: "saas",    hint: "Cockroach Labs" },
  { ticker: "GTLB", name: "GitLab",             sector: "saas",    hint: null },
  { ticker: "PYPL", name: "PayPal",             sector: "fintech", hint: "Stripe" },
  { ticker: "COIN", name: "Coinbase",           sector: "fintech", hint: "Kraken" },
  { ticker: "XYZ",  name: "Block",              sector: "fintech", hint: "Brex" },
  { ticker: "AFRM", name: "Affirm",             sector: "fintech", hint: "Klarna" },
  { ticker: "NU",   name: "Nu Holdings",        sector: "fintech", hint: null },
  { ticker: "NVDA", name: "NVIDIA",             sector: "ai",      hint: "Cerebras" },
  { ticker: "PLTR", name: "Palantir",           sector: "ai",      hint: "Scale AI" },
  { ticker: "ARM",  name: "Arm Holdings",       sector: "ai",      hint: "SiFive" },
  { ticker: "AI",   name: "C3.ai",              sector: "ai",      hint: "Anthropic" },
];

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const FMP_KEY = Deno.env.get("FMP_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!FMP_KEY) return json({ error: "FMP_API_KEY is not set (supabase secrets set FMP_API_KEY=...)" }, 500);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Batch quote (market cap) for the whole universe in one call.
  const symbols = UNIVERSE.map((u) => u.ticker).join(",");
  const quotes = (await fmtJson<any[]>(`${FMP}/quote/${symbols}?apikey=${FMP_KEY}`)) ?? [];
  const quoteBy = new Map<string, any>(quotes.map((q) => [q.symbol, q]));

  const syncedAt = new Date().toISOString();
  const results: { ticker: string; ok: boolean; error?: string }[] = [];

  for (const u of UNIVERSE) {
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
        ticker: u.ticker, name: u.name, sector: u.sector, private_comp_hint: u.hint, synced_at: syncedAt,
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
  return json({ synced_at: syncedAt, total: UNIVERSE.length, ok: okCount, failed: UNIVERSE.length - okCount, results });
});
