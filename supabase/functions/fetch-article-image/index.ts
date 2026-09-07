// =============================================================================
// Supabase Edge Function: fetch-article-image
//
// Thin, read-only proxy that fetches a news article's own page server-side
// and extracts its share/preview image (og:image, falling back to
// twitter:image) — the same signal Slack/Twitter/etc. use to unfurl a link
// preview. Exists so the News tab on a company's tearsheet can show a real
// image for an article whose news[] entry doesn't already carry image_url
// (most older articles, enriched before that field existed) WITHOUT the
// browser fetching the article directly, which fails on almost every real
// news site due to CORS.
//
// No API key/secret needed — this just fetches a public URL server-side.
// Deploy:  supabase functions deploy fetch-article-image --no-verify-jwt
// Invoke:  POST { "url": "https://techcrunch.com/..." } → { "image_url": string | null }
// =============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const FETCH_TIMEOUT_MS = 6_000;
const MAX_HTML_BYTES   = 300_000; // meta tags are always in <head>, no need to read a whole article body

// Matches <meta property="og:image" content="..."> in either attribute
// order, and case/quote-style variations real sites actually use.
function extractMetaContent(html: string, key: "property" | "name", value: string): string | null {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrThenContent = new RegExp(`<meta[^>]+${key}=["']${escaped}["'][^>]*content=["']([^"']+)["']`, "i");
  const contentThenAttr = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*${key}=["']${escaped}["']`, "i");
  return html.match(attrThenContent)?.[1] ?? html.match(contentThenAttr)?.[1] ?? null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let url = "";
  try {
    const body = await req.json();
    url = typeof body?.url === "string" ? body.url.trim() : "";
  } catch {
    return json({ image_url: null, error: "invalid request body" }, 400);
  }
  if (!url) return json({ image_url: null });
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaMapBot/1.0; +https://alphamap.app)",
        "Accept": "text/html",
      },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return json({ image_url: null });
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return json({ image_url: null });

    // Stream-cap the read — meta tags live in <head>, no need to buffer a
    // whole (sometimes multi-MB) article page just to find them.
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (bytes < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        bytes += value.byteLength;
      }
      reader.cancel().catch(() => {});
    } else {
      html = (await res.text()).slice(0, MAX_HTML_BYTES);
    }

    const raw = extractMetaContent(html, "property", "og:image")
      ?? extractMetaContent(html, "name", "twitter:image")
      ?? extractMetaContent(html, "property", "twitter:image");
    if (!raw) return json({ image_url: null });

    // og:image is sometimes a protocol-relative or site-relative URL —
    // resolve it against the article's own (post-redirect) URL.
    const resolved = new URL(raw, res.url).toString();
    return json({ image_url: resolved });
  } catch {
    // Bot-blocked, timed out, DNS failure, etc. — best-effort, same as
    // every other "no image found" case.
    return json({ image_url: null });
  }
});
