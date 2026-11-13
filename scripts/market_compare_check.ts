#!/usr/bin/env node
/**
 * scripts/market_compare_check.ts — the market-peer comparison (marketComparison.ts) on the pairs the owner marked in review runs 11 and 12, with
 * the model. Reads descriptions from the database; a pair whose company or peer is no description found in the database or on its own site is listed as "not on file".
 * Writes nothing. About $0.01 for the whole set. Default: clean descriptions (the judgment alone). WEB=1: a search and the homepage, as a real run finds them.
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

// Short, plain descriptions of what each company sells, as a verified extraction would give them (written for this check, from public
// knowledge). The judgment is measured on these; WEB=1 measures the page reading instead (a search and the homepage), which is noisier.
const FACTS: Record<string, string> = {
  "Acko": "Acko is an Indian digital insurer selling car, bike, health and travel insurance directly to consumers online.",
  "Policybazaar": "Policybazaar is an Indian online insurance marketplace where consumers compare and buy life, health and motor insurance.",
  "SkyDrive": "SkyDrive is a Japanese developer of electric vertical take-off and landing (eVTOL) flying cars and air taxis for passenger and cargo transport.",
  "Archer Aviation": "Archer Aviation designs and builds electric vertical take-off and landing (eVTOL) aircraft for urban air mobility air-taxi services.",
  "Joby Aviation": "Joby Aviation develops electric vertical take-off and landing (eVTOL) aircraft to operate as an air taxi service for passengers.",
  "Eight Sleep": "Eight Sleep makes the Pod, a smart mattress cover that regulates bed temperature and tracks sleep, sold to consumers who want better sleep.",
  "Oura": "Oura makes a smart ring that tracks sleep, activity and readiness, sold to consumers who want to improve their sleep and health.",
  "ActiveCampaign": "ActiveCampaign sells email marketing, marketing automation and CRM software to small and mid-sized businesses.",
  "Mailchimp": "Mailchimp sells email marketing and marketing automation software to small businesses.",
  "Klaviyo": "Klaviyo sells email and SMS marketing automation software to e-commerce businesses.",
  "Vanta": "Vanta sells compliance automation software that helps companies get and keep SOC 2, ISO 27001 and similar security certifications.",
  "AuditBoard": "AuditBoard sells audit, risk and compliance management software to enterprise audit and compliance teams.",
  "Scripbox": "Scripbox is an Indian online wealth platform where consumers invest in mutual funds, with advisory and portfolio management.",
  "Groww": "Groww is an Indian online investment platform where consumers buy mutual funds, stocks and other investments.",
  "EarlySalary": "EarlySalary is an Indian digital lender that gives salaried consumers short-term personal loans through an app.",
  "MoneyTap": "MoneyTap is an Indian digital lender offering consumers a credit line and personal loans through an app.",
  "Livi": "Livi is a digital healthcare provider offering video GP consultations to consumers in the UK.",
  "Teladoc Health": "Teladoc Health provides virtual healthcare: telehealth consultations for consumers and health systems.",
  "Doctor Care Anywhere": "Doctor Care Anywhere provides online GP and telehealth consultations to UK consumers and employers.",
  "Rand McNally": "Rand McNally makes GPS navigation devices and truck routing software for professional drivers and fleets.",
  "Platform Science": "Platform Science sells a telematics and fleet-management platform to trucking fleets.",
  "Navi Technologies": "Navi is an Indian fintech offering consumers personal loans, home loans, insurance and mutual funds through an app.",
  "PhonePe": "PhonePe is an Indian digital payments app for consumers and merchants, with insurance and investments.",
  "Paytm": "Paytm is an Indian payments wallet and financial services app for consumers and merchants.",
  "Rezonate": "Rezonate sells identity-security software that protects cloud identities and access for enterprise security teams.",
  "Silverfort": "Silverfort sells identity-protection software that secures authentication and access across enterprise systems.",
  "Linnworks": "Linnworks sells e-commerce order and inventory management software to online retailers selling across marketplaces.",
  "Extensiv": "Extensiv sells warehouse management and third-party logistics software to fulfilment businesses and brands.",
  "Opus Security": "Opus Security sells cloud security orchestration and remediation software that automates fixing vulnerabilities for security teams.",
  "Laminar": "Laminar sells cloud data security software that discovers and protects sensitive data stored in the cloud.",
  "Dig Security": "Dig Security sells cloud data security posture management software that finds and protects sensitive data in cloud databases.",
  "Figment": "Figment provides blockchain staking infrastructure that lets institutions stake cryptocurrency and earn rewards.",
  "Fireblocks": "Fireblocks sells digital-asset custody and transfer infrastructure to banks, exchanges and fintech firms.",
  "AirStrip": "AirStrip sells mobile software that gives clinicians real-time patient data from electronic health records and monitors.",
  "Philips": "Philips is a large health-technology conglomerate making consumer health products, imaging and patient monitoring equipment.",
  "Smartzer": "Smartzer sells shoppable video technology that lets viewers buy products inside videos, for brands and publishers.",
};

(async () => {
  const WEB = process.env.WEB === "1";
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
  const clean = (name: string) => (FACTS[name] ? { name, description: FACTS[name], website: null, where: "database" as const } : null);
  const companyFacts = async (name: string) => !WEB ? clean(name) : (await lookup([name])).get(name.toLowerCase()) ?? (SITES[name] ? homepage(SITES[name], name) : null);
  const peerFactsOf = async (name: string, company: string, quote: string) => {
    if (!WEB) return clean(name);
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
