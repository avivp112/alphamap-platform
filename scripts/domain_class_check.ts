#!/usr/bin/env node
/**
 * scripts/domain_class_check.ts — the domain classifier (domainClassify.ts) on the owner's examples (2026-11-14), with the class each should get.
 * Calls the model, about $0.01 for the set; writes nothing. Exit code 1 if any differs.
 *
 *   npx tsx scripts/domain_class_check.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildDomainClassRequest } from "../lib/enrichment/domainClassify.ts";
import { parseDomainClass, type DomainClass } from "../lib/enrichment/domainClass.ts";
import { requestFor } from "../lib/enrichment/models.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is required."); process.exit(1); }
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL ?? "claude-haiku-5-5";

// [address, headline (as a search result shows it), the class the owner expects]
const CASES: Array<[string, string, DomainClass]> = [
  ["https://www.moneycontrol.com/news/business/companies/dmi-group-acquires-bnpl-startup-zestmoney-in-a-fire-sale-deal-12072291.html", "DMI Group acquires BNPL startup ZestMoney in a fire sale deal", "news_outlet"],
  ["https://m.economictimes.com/tech/startups/ettech-exclusive-phonepe-calls-off-deal-to-acquire-zestmoney-amid-due-diligence-concerns/articleshow/1.cms", "PhonePe calls off deal to acquire ZestMoney amid due diligence concerns", "news_outlet"],
  ["https://www.newswire.ca/news-releases/cpp-investments-invests-in-hydrostor-to-support-the-global-expansion-of-long-duration-energy-storage-8", "CPP Investments invests in Hydrostor to support the global expansion of long-duration energy storage", "wire"],
  ["https://aramcoventures.com/news/climate-tech-company-promethean-particles-secures-8-million-series-a-investment/", "Climate tech company Promethean Particles secures £8 million Series A investment", "investor"],
  ["https://revenuebase.ai/companies/car-auction-software-companies/united-kingdom", "Car auction software companies in the United Kingdom", "directory_aggregator"],
  ["https://www.startuplist.africa/startups/tymebank", "TymeBank - startuplist.africa", "directory_aggregator"],
  ["https://blog.startupstash.com/top-poland-startups-that-bloomed-in-2022-e28913eb0013", "Top Poland Startups That Bloomed in 2022", "directory_aggregator"],
  ["https://www.gofractional.com/companies/motorway", "Motorway - GoFractional", "directory_aggregator"],
  ["https://www.femaleswitch.com/directories/tpost/marvel-alternatives", "Marvel Alternatives for Prototyping, Wireframing and User Testing", "directory_aggregator"],
  ["https://bouncewatch.com/alternatives/krilltech-nanoagtech", "Krilltech Nanoagtech alternatives", "directory_aggregator"],
  ["https://www.automate.org/companies/aerobotix", "Aerobotix - A3 member company", "directory_aggregator"],
  ["https://www.mux.com/partners/jump-data-driven-video", "JUMP Data-Driven Video is a Mux Partner", "blog_vendor_other"],
  ["https://magnetto.com/case-studies/tayseer", "How Magnetto Drove 13K+ Clicks for Tayseer Arabian Finance", "blog_vendor_other"],
  ["https://cyberinsider.com/email/reviews/posteo/", "Posteo review", "blog_vendor_other"],
  ["https://www.mailjerry.com/posteo-email-settings", "Posteo email settings", "blog_vendor_other"],
];

let wrong = 0;
for (const [url, title, want] of CASES) {
  const msg = await anthropic.messages.create(requestFor(buildDomainClassRequest(url, title, ""), MODEL));
  const tool = msg.content.find((b) => b.type === "tool_use");
  const got = parseDomainClass(tool && tool.type === "tool_use" ? tool.input : null);
  const ok = got.class === want; if (!ok) wrong++;
  console.log(`${ok ? "✅" : "❌"} ${new URL(url).hostname.padEnd(34)} want ${want.padEnd(22)} got ${got.class.padEnd(22)} ${ok ? "" : got.reason}`);
}
console.log(`\n${CASES.length - wrong}/${CASES.length} as expected.`);
process.exit(wrong ? 1 : 0);
