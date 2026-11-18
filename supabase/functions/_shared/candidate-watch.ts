// =============================================================================
// UK watchlist rules — pure, no Deno, no network.
//
// A UK candidate whose registry signals are all weak is "watching" instead of
// waiting in the review queue; it surfaces when one of the events below happens
// at the register or in another source. The ingester (ingest-uk-companies-house)
// fetches the payloads, these functions decide.
// =============================================================================

import type { Signal } from "./candidate-signals.ts";

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => String(v ?? "").trim();

/** Signals that, alone, are enough for a UK candidate to go to review at once. */
export const STRONG_KINDS: ReadonlySet<string> = new Set([
  "known_company_link", "known_company_psc", "investor_psc", "share_allotment",
]);

/** A serial founder (1-5 other active directorships) is strong; "many directorships" is a warning, not strength. */
export function hasStrongSignal(items: Signal[] | undefined | null): boolean {
  return (items ?? []).some((i) =>
    i.level === "positive" && (STRONG_KINDS.has(i.kind) || i.kind === "serial_founder"));
}

export type WatchEventKind = "share_allotment" | "share_class" | "new_articles" | "third_director" | "other_source";

export interface WatchEvent {
  kind: WatchEventKind;
  text: string;
  url?: string;
}

const CH_WEB = "https://find-and-update.company-information.service.gov.uk";

/** Filing types that change the share structure: variation of rights, change of share class. */
const SHARE_CLASS_TYPES = new Set(["SH08", "SH10"]);
/** Resolution adopting new articles of association. */
const ARTICLES_TYPES = new Set(["RES01"]);

export const THIRD_DIRECTOR = 3;

export interface WatchInput {
  companyNumber: string;
  /** GET /company/{n}/filing-history (all categories). */
  filingHistory: Json | null;
  /** Active natural-person directors now (countDirectors over the officers list), or null when not read. */
  directorsNow: number | null;
  /** Directors the candidate had when it was put on the watchlist. */
  directorsAtStart: number;
  /** candidate_cross_source_matches(): the same normalised name in another source. */
  crossSource: Array<{ source: string; name: string; status: string }>;
}

const SOURCE_LABEL: Record<string, string> = {
  epo_ops: "EPO patents", oss_github: "a GitHub project", hf_org: "a Hugging Face org",
  sec_form_d: "SEC Form D", uk_companies_house: "UK Companies House",
};

export function watchEvents(i: WatchInput): WatchEvent[] {
  const url = `${CH_WEB}/company/${encodeURIComponent(i.companyNumber)}/filing-history`;
  const items = arr(i.filingHistory?.items);
  const out: WatchEvent[] = [];

  const allotments = items.filter((f) => str(f.type) === "SH01" && str(f.date));
  if (allotments.length > 0) {
    const latest = allotments.map((f) => str(f.date)).sort().reverse()[0];
    out.push({ kind: "share_allotment", url, text: `Share allotment filed (${allotments.length}, latest ${latest})` });
  }
  const classes = items.filter((f) => SHARE_CLASS_TYPES.has(str(f.type)) && str(f.date));
  if (classes.length > 0) {
    out.push({ kind: "share_class", url, text: `Share class or rights changed (${classes.map((f) => str(f.type)).join(", ")}, ${str(classes[0].date)})` });
  }
  const articles = items.filter((f) => ARTICLES_TYPES.has(str(f.type)) && str(f.date));
  if (articles.length > 0) {
    out.push({ kind: "new_articles", url, text: `New articles of association adopted (${str(articles[0].date)})` });
  }
  if (i.directorsNow !== null && i.directorsNow >= THIRD_DIRECTOR && i.directorsAtStart < THIRD_DIRECTOR) {
    out.push({ kind: "third_director", url: `${CH_WEB}/company/${encodeURIComponent(i.companyNumber)}/officers`,
      text: `Now ${i.directorsNow} directors (${i.directorsAtStart} when put on the watchlist)` });
  }
  if (i.crossSource.length > 0) {
    const m = i.crossSource[0];
    out.push({ kind: "other_source", text: `Same name as ${SOURCE_LABEL[m.source] ?? m.source}: ${m.name} (by name only)` });
  }
  return out;
}

/** What goes in company_candidates.promoted_reason: the events in one line. */
export const promotionReason = (events: WatchEvent[]): string => events.map((e) => e.text).join("; ");
