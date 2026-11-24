#!/usr/bin/env node
/**
 * scripts/why_acquired.ts — why a purchase of the acquired check is gone (owner, 2026-11-24). READS ONLY the log of the check (regression/out/acquired_9/run.log), no model, no web.
 *   npx tsx scripts/why_acquired.ts Aperio Phenom "Rubicon Carbon" Sharethrough
 * Per company: the acquisition searches and their results, the headlines offered to the news gate (🏁), the news dropped (🚫) with the reason, the replay misses (a search or page the recordings did not have),
 * the pages fetched with the characters read and the characters sent to the model (a page cut at its limit), and one line with the cause.
 */
import { existsSync, readFileSync } from "fs";
const f = process.env.LOG ?? "regression/out/acquired_9/run.log";
const names = process.argv.slice(2);
if (!names.length || !existsSync(f)) { console.error(`usage: why_acquired.ts <company…>   (needs ${f})`); process.exit(2); }
const lines = readFileSync(f, "utf8").split("\n");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const n of names) {
  const at = lines.findIndex((l) => new RegExp(`^── ${esc(n)} \\(`).test(l));
  console.log(`\n════ ${n}`);
  if (at < 0) { console.log("  no block of this company in the log"); continue; }
  let end = lines.findIndex((l, i) => i > at && /^── .* \(/.test(l)); if (end < 0) end = lines.length;
  const b = lines.slice(at, end);
  const misses = lines.filter((l) => /REPLAY MISS /.test(l) && l.toLowerCase().includes(n.toLowerCase()));
  const sIdx = b.findIndex((l) => /acquisition searches/.test(l));
  const results: string[] = [];
  if (sIdx >= 0) { results.push(b[sIdx].trim().slice(0, 240)); for (let i = sIdx + 1; i < b.length && /^\s+·/.test(b[i]); i++) results.push(b[i].trim().slice(0, 200)); }
  const offered = b.filter((l) => /🏁/.test(l)).map((l) => l.trim().slice(0, 220));
  const dropped = b.filter((l) => /🚫\s+news|🚫\s+Acquired|acquired/i.test(l) && /🚫/.test(l)).map((l) => l.trim().slice(0, 240));
  const rep = b.filter((l) => /\[DRY\] would write (acquired|news)/.test(l)).map((l) => l.trim().slice(0, 200));
  const pages = b.filter((l) => /🌐\s+fetched/.test(l)).map((l) => { const m = l.match(/fetched (\S+) \((\d+) chars.*?(\d+) sent/); return m ? { url: m[1], chars: +m[2], sent: +m[3] } : null; }).filter((x): x is { url: string; chars: number; sent: number } => !!x);
  console.log("  searches:"); for (const r of results) console.log(`    ${r}`);
  console.log(`  offered to the news gate (🏁): ${offered.length ? "" : "none"}`); for (const o of offered) console.log(`    ${o}`);
  console.log(`  news dropped (🚫): ${dropped.length ? "" : "none"}`); for (const d of dropped) console.log(`    ${d}`);
  console.log(`  would write: ${rep.length ? "" : "no acquired / news row"}`); for (const r of rep) console.log(`    ${r}`);
  console.log(`  replay misses: ${misses.length ? "" : "none"}`); for (const m of misses) console.log(`    ${m.trim().slice(0, 220)}`);
  const cut = pages.filter((p) => p.sent < p.chars && /news|press|acqui|blog|article|\d{4}/i.test(p.url));
  console.log(`  pages fetched: ${pages.length}; cut before the model (news/press/article pages): ${cut.length}`); for (const p of cut.slice(0, 8)) console.log(`    ${p.url}  ${p.chars} → ${p.sent}`);
  // the one-line cause
  let cause: string;
  const headlineInSearch = results.slice(1).some((r) => /acqui|buys|bought|merge|to join|takes over/i.test(r));
  if (!results.length) cause = "no acquisition search in this company's block (the step did not run)";
  else if (/: 0 result/.test(results[0])) cause = misses.length ? "the searches returned nothing — the recordings had no answer for them (REPLAY MISS)" : "the searches returned nothing";
  else if (!headlineInSearch && !offered.length) cause = misses.length ? "no result names an acquisition; replay misses on this company" : "no result names an acquisition (the search results changed or never held it)";
  else if (offered.length && !rep.length) cause = `offered to the news gate and not written: ${dropped[0] ?? "no reason logged"}`;
  else if (headlineInSearch && !offered.length) cause = "a result looks like an acquisition headline, but it was not offered (extraction: the headline's form, or a repeated URL)";
  else cause = "see the lines above";
  console.log(`  ▶ cause: ${cause}`);
}
