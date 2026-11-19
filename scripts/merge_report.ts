#!/usr/bin/env node
/**
 * scripts/merge_report.ts — the rows of a re-run company replace its rows in the batch's report (owner, 2026-11-19: one company crashed; run only it, then merge).
 *   BASE=pilot_report_dry.csv RETRY=pilot_report_retry.csv npx tsx scripts/merge_report.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
const base = process.env.BASE ?? "pilot_report_dry.csv", retry = process.env.RETRY ?? "pilot_report_retry.csv";
const [bh, ...bb] = parseCsv(readFileSync(base, "utf8")), [rh, ...rb] = parseCsv(readFileSync(retry, "utf8"));
if (bh.join() !== rh.join()) { console.error("the two reports have different columns — nothing merged"); process.exit(1); }
const ci = bh.indexOf("company"), co = new Set(rb.map((r) => r[ci]));
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const out = [bh, ...bb.filter((r) => !co.has(r[ci])), ...rb];
writeFileSync(base, "﻿" + out.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n");
console.log(`${[...co].join(", ")}: ${rb.length} row(s) replaced in ${base}`);
