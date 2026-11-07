#!/usr/bin/env node
/**
 * scripts/hq_site_probe.ts — what a company's own site says about where it sits (owner, 2026-11-07:
 * Kraken, Lupovis, CData, InfiniGrow and Cyera got no headquarters). No search, no model, no cost, writes
 * nothing: it fetches the site's home, contact, about and company pages and prints
 *   - the lines that look like an address or a headquarters statement, as a person would read them;
 *   - what lib/enrichment/headquarters.ts contactPageAddresses makes of the same pages.
 *
 *   ONLY=kraken-technologies,lupovis,cdata,infinigrow,cyera npx tsx scripts/hq_site_probe.ts
 *
 * Companies are the golden set's (their websites are in eval/golden_set.json); URLS=https://a.com,https://b.com adds others.
 */
import * as cheerio from "cheerio";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { contactPageAddresses } from "../lib/enrichment/headquarters.ts";

const PATHS = ["/", "/contact", "/contact-us", "/contactus", "/about", "/about-us", "/company", "/en/contact", "/get-in-touch"];
const ADDRESS = /\b(headquarter\w*|head office|hq|corporate office|our offices?|registered office|office|address|located in|based in|find us|visit us)\b|\b\d{1,5}\s+[\p{L}.' -]{2,40}\b(street|st\.?|avenue|ave\.?|road|rd\.?|blvd|boulevard|floor|suite|plaza|lane|ln\.?|way|drive)\b|\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/iu;

async function textOf(url: string): Promise<{ status: number; final: string; text: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; alphamap-probe)" } });
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, head").remove();
    $("body *").each((_, el) => { $(el).prepend("\n").append("\n"); });
    const text = $("body").text().split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
    return { status: res.status, final: res.url, text };
  } catch { return null; }
}

(async () => {
  const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "eval", "golden_set.json"), "utf8")).companies as Array<{ id: string; name: string; website?: string }>;
  const targets = [
    ...golden.filter((g) => only.includes(g.id.toLowerCase()) || only.includes(g.name.toLowerCase())).map((g) => ({ name: g.name, site: g.website ?? "" })),
    ...(process.env.URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean).map((u) => ({ name: u, site: u })),
  ];
  if (!targets.length) { console.error("Set ONLY=<golden id>[,…] and/or URLS=<site>[,…]."); process.exit(1); }
  for (const t of targets) {
    console.log(`\n══ ${t.name} — ${t.site || "(no website)"}`);
    if (!t.site) continue;
    const root = new URL(t.site.startsWith("http") ? t.site : `https://${t.site}`).origin;
    const seen = new Set<string>();
    for (const path of PATHS) {
      const page = await textOf(root + path);
      if (!page || page.status >= 400 || seen.has(page.final)) { if (page) console.log(`  ${path}: HTTP ${page.status}${seen.has(page.final) ? " (same page as another)" : ""}`); continue; }
      seen.add(page.final);
      const lines = page.text.split("\n").filter((l) => l.length <= 220 && ADDRESS.test(l)).slice(0, 14);
      console.log(`  ${path} → ${page.final}${page.final !== root + path ? " (redirected)" : ""}: ${lines.length} address-like line(s)`);
      for (const l of lines) console.log(`      │ ${l}`);
      const parsed = contactPageAddresses({ url: page.final.match(/\/contact/i) ? page.final : `${page.final.replace(/\/$/, "")}/contact`, source_type: "company_site", content: page.text, source_id: "P" });
      if (parsed.length) console.log(`      ⇒ the pipeline's contact-page reading: ${parsed.map((p) => `${p.city} ("${p.quote.slice(0, 80)}")`).join(" | ")}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
