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

// FMP retired the legacy /v3/search endpoint (it now 403s with a
// "Legacy Endpoint" message even for otherwise-valid keys) in favor of two
// separate stable endpoints — one for ticker-symbol matches, one for
// company-name matches. We query both and merge, since a search bar needs to
// match on either "AAPL" or "Apple".
const FMP = "https://financialmodelingprep.com/stable";

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
  exchange?: string;
  exchangeFullName?: string;
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
    const q = encodeURIComponent(query);
    const [symbolRes, nameRes] = await Promise.all([
      fetch(`${FMP}/search-symbol?query=${q}&limit=10&apikey=${FMP_KEY}`),
      fetch(`${FMP}/search-name?query=${q}&limit=10&apikey=${FMP_KEY}`),
    ]);
    if (!symbolRes.ok && !nameRes.ok) {
      return json({ error: `FMP responded ${symbolRes.status}` }, 502);
    }
    const [symbolData, nameData] = await Promise.all([
      symbolRes.ok ? (symbolRes.json() as Promise<FmpSearchResult[]>) : Promise.resolve([]),
      nameRes.ok ? (nameRes.json() as Promise<FmpSearchResult[]>) : Promise.resolve([]),
    ]);
    const merged = [...(Array.isArray(symbolData) ? symbolData : []), ...(Array.isArray(nameData) ? nameData : [])];

    const isNasdaqOrNyse = (r: FmpSearchResult) => {
      const tag = `${r.exchange ?? ""} ${r.exchangeFullName ?? ""}`.toUpperCase();
      return tag.includes("NASDAQ") || tag.includes("NYSE");
    };

    // FMP returns each endpoint's own results in ITS relevance order, but
    // merging the two lists (symbol matches, then name matches) with no
    // re-ranking meant a search for a full company name could put an
    // unrelated ticker ahead of the actual company — e.g. searching
    // "Snowflake" wasn't guaranteed to put SNOW first. Rank by how well
    // EITHER the symbol or the name matches what was typed: exact match
    // first, then starts-with, then contains — so the obvious answer is
    // always at the top regardless of which endpoint or order it came back in.
    const qLower = query.toLowerCase();
    function matchRank(r: FmpSearchResult): number {
      const sym  = r.symbol.toLowerCase();
      const name = r.name.toLowerCase();
      if (sym === qLower || name === qLower) return 0;
      if (sym.startsWith(qLower) || name.startsWith(qLower)) return 1;
      if (name.includes(qLower)) return 2;
      return 3;
    }

    const seen = new Set<string>();
    const results = merged
      .filter((r) => r.symbol && r.name)
      .filter(isNasdaqOrNyse)
      .filter((r) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)))
      .sort((a, b) => matchRank(a) - matchRank(b))
      .slice(0, 10)
      .map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange || r.exchangeFullName || "" }));

    return json({ results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "search failed" }, 500);
  }
});
