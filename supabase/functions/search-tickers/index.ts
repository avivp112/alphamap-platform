// =============================================================================
// Supabase Edge Function: search-tickers
//
// Thin, read-only proxy in front of Financial Modeling Prep's ticker search so
// the browser can look up ANY NASDAQ/NYSE symbol without ever holding the FMP
// key client-side. Powers the Public Market Hub's stock search bar.
//
// Secrets: FMP_API_KEY (same secret sync-public-markets uses).
// Deploy:  supabase functions deploy search-tickers --no-verify-jwt
// Invoke:  POST { "query": "snow" } → [{ symbol, name, exchange }, ...]
// =============================================================================

const FMP = "https://financialmodelingprep.com/api/v3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

interface FmpSearchResult {
  symbol: string;
  name: string;
  exchangeShortName?: string;
  currency?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const FMP_KEY = Deno.env.get("FMP_API_KEY");
  if (!FMP_KEY) return json({ error: "FMP_API_KEY is not set (supabase secrets set FMP_API_KEY=...)" }, 500);

  let query = "";
  try {
    const body = await req.json();
    query = typeof body?.query === "string" ? body.query.trim() : "";
  } catch {
    const url = new URL(req.url);
    query = url.searchParams.get("query")?.trim() ?? "";
  }
  if (query.length < 1) return json({ results: [] });
  if (query.length > 40) query = query.slice(0, 40);

  try {
    const url = `${FMP}/search?query=${encodeURIComponent(query)}&exchange=NASDAQ,NYSE&limit=10&apikey=${FMP_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return json({ error: `FMP responded ${res.status}` }, 502);
    const data = (await res.json()) as FmpSearchResult[];
    if (!Array.isArray(data)) return json({ results: [] });

    const results = data
      .filter((r) => r.symbol && r.name)
      .filter((r) => (r.exchangeShortName ?? "").toUpperCase() === "NASDAQ" || (r.exchangeShortName ?? "").toUpperCase() === "NYSE")
      .slice(0, 10)
      .map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchangeShortName ?? "" }));

    return json({ results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "search failed" }, 500);
  }
});
