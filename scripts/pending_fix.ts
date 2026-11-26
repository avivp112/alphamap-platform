#!/usr/bin/env node
/**
 * scripts/pending_fix.ts — takes a value out of pending_fixes.csv (excluded by mistake; owner, 2026-11-19: Berg System's tag CRM — the quote is the product's description).
 *   BATCH=8 npx tsx scripts/pending_fix.ts remove "Berg System" tags
 */
import { removePendingFix } from "../lib/enrichment/batchProcess.ts";
const [cmd, company, field] = process.argv.slice(2);
const batch = Number(process.env.BATCH);
if (cmd !== "remove" || !company || !field || !Number.isInteger(batch)) { console.error('usage: BATCH=8 pending_fix.ts remove "Company" field'); process.exit(2); }
console.log(`${removePendingFix(batch, company, field)} pending fix(es) of ${company} · ${field} taken out of pending_fixes.csv`);
