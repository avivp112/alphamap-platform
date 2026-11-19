#!/usr/bin/env node
/**
 * scripts/website_decision.ts — records the owner's approved address for a company (eval/website_decisions.json). Needs APPROVED_BY=aviv.
 *   APPROVED_BY=aviv npx tsx scripts/website_decision.ts "Lulalend" https://lula.co.za
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
const [name, site] = process.argv.slice(2);
if (process.env.APPROVED_BY !== "aviv") { console.error("⛔  An address is decided by the owner: APPROVED_BY=aviv npx tsx scripts/website_decision.ts \"Company\" https://…"); process.exit(1); }
if (!name || !/^https?:\/\//.test(site ?? "")) { console.error("usage: website_decision.ts \"Company\" https://address"); process.exit(2); }
const f = "eval/website_decisions.json";
const cur = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) as Record<string, string> : {};
cur[name] = site;
writeFileSync(f, JSON.stringify(cur, null, 1) + "\n");
console.log(`${name} → ${site} (eval/website_decisions.json). Commit it.`);
