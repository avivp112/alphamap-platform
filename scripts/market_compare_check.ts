#!/usr/bin/env node
/**
 * scripts/market_compare_check.ts — the market-peer comparison (marketComparison.ts) on the pairs the owner marked in review runs 11 and 12, with
 * the model. Reads descriptions from the database; a pair whose company or peer is not on file with a description is listed as "not on file".
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
  let agree = 0, judged = 0, tokensIn = 0, tokensOut = 0;
  for (const [company, peer, expected, quote] of PAIRS) {
    const own = (await lookup([company])).get(company.toLowerCase());
    const peerFacts = (await lookup([peer])).get(peer.toLowerCase());
    if (!own || !peerFacts) { console.log(`  —  ${company} ↔ ${peer}: not on file with a description (${!own ? company : peer})`); continue; }
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
    console.log(`  ${kept === expected ? "✓" : "✗"}  ${company} ↔ ${peer}: owner ${expected ? "competitor" : "not"} · now ${kept ? "kept" : `dropped (${r.dropped[0]?.why.slice(0, 110)})`}`);
  }
  console.log(`\nAgree with the owner: ${agree}/${judged}. Tokens: ${tokensIn} in, ${tokensOut} out (${judged} calls of one candidate each; a company's real call holds up to five candidates).`);
})().catch((e) => { console.error(e); process.exit(1); });
