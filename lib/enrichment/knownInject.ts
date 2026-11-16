/**
 * lib/enrichment/knownInject.ts — a wet run starts from the memory of verified sources (owner, round 10): a value that was verified before, whose quote is still on its page, and
 * that this run did not find again is put into the collected company as if the run had found it — with its source and quote — so the write stage treats it exactly as it treats a found
 * value: the open-field gate, the fill-only rule (a column that has a value is not overwritten), field_provenance and field_changes. Nothing is written here.
 * Covered: headquarters city and country, founded year, founding country, description, sector, tags, news, founders and leaders. Rounds, headcount, offices, patents and competitors are carried in the report only.
 */
import type { CollectedCompany } from "./collect.ts";
import type { KnownEntry } from "./knownSources.ts";
import { computeFieldConfidence } from "./confidence.ts";
import type { LabeledSource } from "./sources.ts";
import type { SourceType } from "./sourceTypes.ts";

const hostOf = (u: string) => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const registrable = (h: string) => h.split(".").slice(-(/\.(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(h) ? 3 : 2)).join(".");

export function injectKnown(collected: CollectedCompany, confirmed: KnownEntry[], websiteHost: string | null): string[] {
  const done: string[] = [];
  let n = 0;
  const profile = collected.profile.profile;
  const ownRoot = websiteHost ? registrable(websiteHost) : "";
  const source = (e: KnownEntry): { source_id: string; type: SourceType } => {
    const type: SourceType = ownRoot && registrable(hostOf(e.source_url)) === ownRoot ? "company_site" : "news";
    const existing = collected.allSources.find((s) => s.url === e.source_url);
    if (existing) return { source_id: existing.source_id, type: existing.source_type };
    const s: LabeledSource = { source_id: `K${++n}`, source_type: type, url: e.source_url, title: "", content: e.quote || e.value, provider: "serper", query_label: "known_source" } as LabeledSource;
    collected.allSources.push(s); collected.sourceById.set(s.source_id, s);
    return { source_id: s.source_id, type };
  };
  const ev = <T,>(value: T, e: KnownEntry) => ({ value, source_id: source(e).source_id, evidence_quote: e.quote || String(value) });
  for (const e of confirmed) {
    const f = e.field;
    if (f === "hq_city" && !profile.city) {
      profile.city = ev(e.value, e); collected.validation.accepted.city = e.value;
      collected.cityConfidence = computeFieldConfidence([{ source_type: source(e).type }]); done.push(f);
    } else if (f === "hq_country" && !profile.country) {
      profile.country = ev(e.value, e); collected.validation.accepted.country = e.value;
      collected.countryConfidence = computeFieldConfidence([{ source_type: source(e).type }]); done.push(f);
    } else if (f === "founded_year" && !profile.founded_year && /^\d{4}$/.test(e.value.trim())) {
      profile.founded_year = ev(Number(e.value.trim()), e); collected.validation.accepted.founded_year = Number(e.value.trim()); done.push(f);
    } else if (f === "founding_country" && !profile.founding_country) {
      profile.founding_country = ev(e.value, e); done.push(f);
    } else if ((f === "description" || f === "description_what_only") && !profile.description_sentences?.length) {
      const sid = source(e).source_id;
      profile.description = e.value;
      profile.description_complete = f === "description";
      profile.description_sentences = [{ role: "what", text: e.value, source_ids: [sid], quote: e.quote || e.value }];
      done.push(f);
    } else if (f === "sector" && !profile.sector_name) {
      profile.sector_name = e.value.replace(/\s*\(industry:[^)]*\)\s*$/, "").trim(); done.push(f);
    } else if (f === "tags" && !(profile.sub_sector_names?.length || profile.sub_sector_name)) {
      profile.sub_sector_names = e.value.split(/\s*,\s*/).filter(Boolean).slice(0, 4); done.push(f);
    }
  }
  // Lists: one entry per value, added when the run did not find the same one (by address for news, by name for people).
  const samePerson = (a: string, b: string) => a.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const split = (v: string) => { const i = v.indexOf(" — "); return i < 0 ? [v.trim(), ""] as const : [v.slice(0, i).trim(), v.slice(i + 3).trim()] as const; };
  for (const e of confirmed) {
    if (e.field === "news") {
      const [date, title] = split(e.value);
      if (!title || collected.market.news.some((n) => n.url === e.source_url)) continue;
      collected.market.news.push({ title, url: e.source_url, published_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined });
      done.includes("news") || done.push("news");
    } else if (e.field === "founder") {
      const [name, title] = split(e.value);
      const list = profile.founders ?? (profile.founders = []);
      if (!name || list.some((f) => samePerson(f.name, name))) continue;
      list.push({ name, ...(title ? { title } : {}), grounded_url: e.source_url } as never);
      done.includes("founder") || done.push("founder");
    } else if (e.field === "leader") {
      const [name, role] = split(e.value.split(" · ")[0]);
      if (!name || !role || collected.profile.leadership.some((l) => samePerson(l.name, name))) continue;
      collected.profile.leadership.push({ name, role } as never);
      done.includes("leader") || done.push("leader");
    }
  }
  return done;
}
