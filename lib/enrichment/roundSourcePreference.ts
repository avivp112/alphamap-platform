/**
 * lib/enrichment/roundSourcePreference.ts — which source a round rests on, when it has several (owner, 2026-11-24: Lendo's Series B stood on einpresswire.com, a paid distribution page, while the company's
 * own press release says the same sentence). The order: the company's own site, then press and other pages, then a press wire, and a paid distribution service last. A field's source is changed only
 * to a source that holds the field's evidence quote word for word, so the quote still stands on the page it is shown with. Pure.
 */
import type { V2Round } from "./extractFunding.ts";
import type { LabeledSource } from "./sources.ts";
import { roundSourceStanding } from "./roundSources.ts";

const PAID = /(^|\.)(einpresswire|marketersmedia|yespress|openpr|prlog|send2press|newswire\.net|pr\.com|prweb|accesswire|accessnewswire|24-7pressrelease|pressat|issuewire|ein\.news)\./i;
const WIRE = /(^|\.)(prnewswire|businesswire|globenewswire)\.[a-z.]+$/i;

export function sourceRank(s: Pick<LabeledSource, "url" | "source_type">): number {
  let host = ""; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { return 1; }
  if (PAID.test(`${host}.`)) return 3;
  if (s.source_type === "company_site") return 0;
  if (WIRE.test(host)) return 2;
  return 1;
}

const norm = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const FIELDS = ["amount_raised", "valuation", "announcement_date", "lead_investor"] as const;

/** Moves each round field that rests on a worse source to a better source that holds its quote; returns what moved, for the log. */
export function preferBetterRoundSources(rounds: V2Round[], sources: LabeledSource[], companyName: string): string[] {
  const moved: string[] = [];
  const byId = new Map(sources.map((s) => [s.source_id, s]));
  const text = new Map(sources.map((s) => [s.source_id, norm(`${s.title ?? ""} ${s.content ?? ""}`)]));
  for (const r of rounds) {
    for (const f of FIELDS) {
      const e = r[f] as { source_id: string; evidence_quote: string } | undefined;
      const cur = e && byId.get(e.source_id);
      if (!e || !cur) continue;
      const rank = sourceRank(cur);
      if (rank === 0) continue;
      const q = norm(e.evidence_quote);
      if (q.length < 12) continue;
      const better = sources
        .filter((s) => s.source_id !== e.source_id && sourceRank(s) < rank && (text.get(s.source_id) ?? "").includes(q)
          && roundSourceStanding(s.url, { companyName, isCompanySite: s.source_type === "company_site", content: s.content }).kind === "allowed")
        .sort((a, b) => sourceRank(a) - sourceRank(b))[0];
      if (!better) continue;
      moved.push(`${r.round_type} ${f}: ${cur.url} → ${better.url}`);
      e.source_id = better.source_id;
      if (r.source_url && r.source_url === cur.url) r.source_url = better.url;
    }
  }
  return moved;
}
