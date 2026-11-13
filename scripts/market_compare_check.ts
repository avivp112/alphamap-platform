#!/usr/bin/env node
/**
 * scripts/market_compare_check.ts — the market-peer comparison (marketComparison.ts) on the pairs the owner marked in review runs 11 and 12, with
 * the model. Reads descriptions from the database; a pair whose company or peer is no description found in the database or on its own site is listed as "not on file".
 * Writes nothing. About $0.01 for the whole set.
 *
 *   npx tsx scripts/market_compare_check.ts
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { judgeMarketPeers, type PeerClaim } from "../lib/enrichment/marketComparison.ts";
import { makePeerLookup } from "../lib/enrichment/peerLookup.ts";
import { requestFor } from "../lib/enrichment/models.ts";
import { createSearchProviderState, webSearch, readPageCached } from "../lib/enrichment/searchProviders.ts";
import { isDataPlatformUrl } from "../lib/enrichment/dataPlatforms.ts";
import { peerSiteQuery, pickPeerSite } from "../lib/enrichment/peerSite.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.ANTHROPIC_API_KEY) { console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL ?? "claude-haiku-5-5";

// [company, peer, the owner's verdict: true = a real market competitor, quote]
const PAIRS: Array<[string, string, boolean, string]> = [
  ["Acko", "Policybazaar", true, "Acko competes with players including Policybazaar and ICICI Lombard"],
  ["SkyDrive", "Archer Aviation", true, "Startups competing with SkyDrive include Archer Aviation"],
  ["SkyDrive", "Joby Aviation", true, "Startups competing with SkyDrive include Joby Aviation"],
  ["Eight Sleep", "Oura", true, "Eight Sleep competes with Oura and Whoop"],
  ["ActiveCampaign", "Mailchimp", true, "ActiveCampaign is a strong Mailchimp alternative"],
  ["ActiveCampaign", "Klaviyo", true, "ActiveCampaign alternatives, including HubSpot, Mailchimp, and Klaviyo"],
  ["Vanta", "AuditBoard", true, "Compare top platforms like Vanta, AuditBoard"],
  ["Scripbox", "Groww", true, "Scripbox competes with a slew of startups including Groww"],
  ["EarlySalary", "MoneyTap", true, "EarlySalary directly competes with Slice, ZestMoney, LoanTap, PaySense, MoneyTap"],
  ["Livi", "Teladoc Health", true, "UK telehealth market: Doctor Care Anywhere, Teladoc Health, Livi"],
  ["Livi", "Doctor Care Anywhere", true, "UK telehealth market: Doctor Care Anywhere, Teladoc Health, Livi"],
  ["Rand McNally", "Platform Science", false, "Truck-safe navigation powered by Platform Science"],
  ["Navi Technologies", "PhonePe", false, "In contrast to PhonePe, Paytm… which started as payment startups"],
  ["Navi Technologies", "Paytm", false, "In contrast to PhonePe, Paytm… which started as payment startups"],
  ["Rezonate", "Silverfort", false, "Together, Silverfort and Rezonate deliver an identity security platform"],
  ["Linnworks", "Extensiv", false, "Brands run Linnworks and Extensiv together"],
  ["Opus Security", "Laminar", false, "There's also Dig Security, Laminar and Opus Security"],
  ["Opus Security", "Dig Security", false, "There's also Dig Security, Laminar and Opus Security"],
  ["Figment", "Fireblocks", false, "staking revenue lines with Figment and Fireblocks"],
  ["AirStrip", "Philips", false, "mHealth App Market: Johnson and Johnson, Omron, Airstrip, Philips, Qualcomm dominate"],
  ["Smartzer", "Shoppable", false, "a shoppable video storefront"],
];

(async () => {
  const lookup = makePeerLookup(db);
  const state = createSearchProviderState();
  // The company side is read from its own site (in a real run: the extracted description); the peer side exactly as collect.ts does it:
  // the database, else a search with the sentence's context words and the candidate's own host.
  const SITES: Record<string, string> = {
    "Acko": "https://www.acko.com", "SkyDrive": "https://skydrive2020.com", "Eight Sleep": "https://www.eightsleep.com", "ActiveCampaign": "https://www.activecampaign.com",
    "Vanta": "https://www.vanta.com", "Scripbox": "https://scripbox.com", "EarlySalary": "https://www.earlysalary.com", "Livi": "https://www.livi.co.uk",
    "Rand McNally": "https://www.randmcnally.com", "Navi Technologies": "https://navi.com", "Rezonate": "https://rezonate.io", "Linnworks": "https://www.linnworks.com",
    "Opus Security": "https://www.opus.security", "Figment": "https://www.figment.io", "AirStrip": "https://www.airstrip.com", "Smartzer": "https://www.smartzer.com",
  };
  const homepage = async (origin: string, name: string) => {
    const text = ((await readPageCached(origin, state))?.text ?? "").replace(/\s+/g, " ").trim();
    return text.length >= 200 ? { name, description: text.slice(0, 700), website: origin, where: "own_site" as const } : null;
  };
  const companyFacts = async (name: string) => (await lookup([name])).get(name.toLowerCase()) ?? (SITES[name] ? homepage(SITES[name], name) : null);
  const peerFactsOf = async (name: string, company: string, quote: string) => {
    const hit = (await lookup([name])).get(name.toLowerCase());
    if (hit) return hit;
    const home = pickPeerSite((await webSearch(peerSiteQuery(name, quote, company), "peer_site", state)).filter((r) => r.url && !isDataPlatformUrl(r.url)), name);
    return home ? homepage(home, name) : null;
  };
  let agree = 0, judged = 0, tokensIn = 0, tokensOut = 0;
  // The owner's two counts (2026-11-13): a wrong peer let in is worse than a right one dropped.
  const wrong = { total: 0, kept: 0, dropped: 0, noSite: 0 }, right = { total: 0, kept: 0, dropped: 0, noSite: 0 };
  for (const [company, peer, expected, quote] of PAIRS) {
    const own = await companyFacts(company);
    const peerFacts = await peerFactsOf(peer, company, quote);
    const tally = expected ? right : wrong;
    tally.total++;
    if (!own || !peerFacts) { tally.noSite++; console.log(`  —  ${company} ↔ ${peer}: not on file with a description (${!own ? company : peer})`); continue; }
    const claim: PeerClaim = { name: peer, source_id: "S1", evidence_quote: quote, how_it_competes: quote, tier: "market" };
    const r = await judgeMarketPeers({
      resolve: async () => peerFacts,
      ask: async (request) => {
        const msg = await anthropic.messages.create(requestFor(request, MODEL));
        tokensIn += msg.usage.input_tokens; tokensOut += msg.usage.output_tokens;
        const tool = msg.content.find((b) => b.type === "tool_use");
        return tool && tool.type === "tool_use" ? tool.input : null;
      },
    }, { name: company, description: own.description }, [claim]);
    const kept = r.kept.length === 1;
    judged++; if (kept === expected) agree++;
    if (kept) tally.kept++; else tally.dropped++;
    console.log(`  ${kept === expected ? "✓" : "✗"}  ${company} ↔ ${peer}: owner ${expected ? "competitor" : "not"} · now ${kept ? "kept" : `dropped (${r.dropped[0]?.why.slice(0, 110)})`}`);
  }
  console.log(`\nWRONG pairs that got through:  ${wrong.kept} of ${wrong.total}   (aim 0)   — dropped by the comparison ${wrong.dropped}, dropped for having no site or description ${wrong.noSite}`);
  console.log(`RIGHT pairs that were kept:    ${right.kept} of ${right.total}   (aim at least 8)   — dropped by the comparison ${right.dropped}, lost for having no site or description ${right.noSite}`);
  console.log(`\nAgree with the owner: ${agree}/${judged}. Tokens: ${tokensIn} in, ${tokensOut} out (${judged} calls of one candidate each; a company's real call holds up to five candidates).`);
})().catch((e) => { console.error(e); process.exit(1); });
