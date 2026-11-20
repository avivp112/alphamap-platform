#!/usr/bin/env node
/**
 * scripts/clear_held.ts — takes a batch's held-field rows of one source out of held_fields.csv (owner, 2026-11-20: held fields concern core fields only and come from the post-write audit; the sample
 * check's holds of batch 8 end with the old method).   BATCH=8 SOURCE=sample_50 npx tsx scripts/clear_held.ts
 */
import { clearHeld } from "../lib/enrichment/batchProcess.ts";
const batch = Number(process.env.BATCH);
if (!Number.isInteger(batch) || !process.env.SOURCE) { console.error("BATCH=<n> SOURCE=<source> are required"); process.exit(2); }
console.log(`${clearHeld(batch, process.env.SOURCE)} held-field row(s) of batch ${batch} (${process.env.SOURCE}) removed from held_fields.csv.`);
