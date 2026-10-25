// =============================================================================
// worker/promote.ts — a checked company enters AlphaMap only after an admin
// approves it (migration 20261025000000, decision of 2026-10-19).
//
//   1. A check that ends with a profile is proposed for review, with the
//      research exactly as collected (serializeCollected).
//   2. The admin approves it on /admin/review ("From user checks").
//   3. This worker writes it with enrichment v2's own Stage 10
//      (lib/enrichment/writeCompany.ts — the code the bulk run uses), from
//      the same collection the admin saw, never a new one.
//
// A company that entered AlphaMap meanwhile (same website) is linked, and
// nothing is written over it: its rounds were planned against an empty file.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { roundRefs, newAcceptedRounds, type CollectedCompany, type V2StartupRow, type V2FundingRoundRow } from "../lib/enrichment/collect.ts";
import { planRoundWrites } from "../lib/enrichment/assemble.ts";
import type { LabeledSource } from "../lib/enrichment/sources.ts";
import type { SourceType } from "../lib/enrichment/sourceTypes.ts";
import type { SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { writeCollected, newWriteSummary, BULK_THRESHOLDS } from "../lib/enrichment/writeCompany.ts";
import { websiteDomain, type DomainOwner } from "../lib/enrichment/websiteValidation.ts";

// Not stored: lookups rebuilt from allSources, and page text Stage 10 never reads.
type StoredSource = Pick<LabeledSource, "source_id" | "source_type" | "url" | "title" | "query_label">;
export type StoredCollection = Omit<CollectedCompany, "sourceById" | "sourceTypeFor" | "sourceUrlFor" | "allSources"> & {
  allSources: StoredSource[];
};

/** What check_promotions.collected holds: plain JSON. */
export function serializeCollected(c: CollectedCompany): StoredCollection {
  const { sourceById: _byId, sourceTypeFor: _type, sourceUrlFor: _url, allSources, ...rest } = c;
  return {
    ...rest,
    allSources: allSources.map((s) => ({ source_id: s.source_id, source_type: s.source_type, url: s.url, title: s.title, query_label: s.query_label })),
  };
}

/** Back to what writeCollected takes. */
export function deserializeCollected(stored: StoredCollection): CollectedCompany {
  const allSources = stored.allSources.map((s) => ({ ...s, content: "", provider: "serper" }) as LabeledSource);
  const sourceById = new Map(allSources.map((s) => [s.source_id, s]));
  return {
    ...stored,
    outcome: "collected",
    allSources,
    sourceById,
    sourceTypeFor: (id: string | undefined): SourceType | undefined => (id ? sourceById.get(id)?.source_type : undefined),
    sourceUrlFor: (id: string | undefined): string | null => (id ? sourceById.get(id)?.url ?? null : null),
  };
}

/** A new startups row as Stage 10 sees it: name and website, nothing else on file. */
export function freshRow(id: string, name: string, website: string | null): V2StartupRow {
  return {
    id, name, website,
    description: null, value_proposition: null, industry: null,
    founded_year: null, country: null, city: null, founding_country: null, israel_rnd_center: null, refresh_fields: [],
    employee_count: null, employee_range: null, growth_trend: null,
    founders: null, leadership: null, competitors: null, acquisitions: null, news: null,
    patent_count: null, patent_fields: null, patents: null,
    tech_stack: null, github_url: null, huggingface_url: null,
    arr_milestones: null, revenue_estimate: null, valuation_benchmarks: null,
    linkedin_url: null, facebook_url: null, instagram_url: null,
    sector_id: null, funding_history_complete: null,
    status: "active", last_enriched_at: null, is_manually_verified: false,
  };
}

export interface PromotionJob {
  id: string;
  /** new = add the company; update = a deepen's additions to the AlphaMap company in startup_id. */
  kind?: "new" | "update";
  startup_id?: string | null;
  check_id: string;
  user_id: string;
  name: string;
  website: string | null;
  collected: StoredCollection;
}

export interface PromoteDeps {
  db: SupabaseClient;
  /** The company and its rounds as they are now (worker/deepen.ts loadCompany). */
  loadCompany?: (startupId: string) => Promise<{ row: V2StartupRow; rounds: V2FundingRoundRow[] } | null>;
  taxonomy: () => Promise<SectorTaxonomy>;
  findExisting: (website: string) => Promise<{ id: string; name: string } | null>;
  notify: (userId: string, title: string, body: string, link: string) => Promise<void>;
  log?: (msg: string) => void;
}

/** One approved company, written. Returns false when none is waiting. */
export async function promoteOne(d: PromoteDeps): Promise<boolean> {
  const log = d.log ?? ((m: string) => console.log(`[worker] ${m}`));
  const { data, error } = await d.db.rpc("claim_check_promotion");
  if (error) throw new Error(`claim_check_promotion: ${error.message}`);
  const job = data as PromotionJob | null;
  if (!job?.id) return false;
  log(`promotion ${job.id}: ${job.name}`);

  const finish = async (status: "written" | "linked" | "failed", startupId: string | null, err: string | null) => {
    const { error: e } = await d.db.rpc("finish_check_promotion", { p_id: job.id, p_status: status, p_startup_id: startupId, p_error: err });
    if (e) throw new Error(`finish_check_promotion: ${e.message}`);
  };

  try {
    if (job.kind === "update") {
      if (!job.startup_id || !d.loadCompany) throw new Error("update without its company");
      const company = await d.loadCompany(job.startup_id);
      if (!company) throw new Error("the company is no longer in AlphaMap");
      // Rounds were planned against the file at research time: plan again against today's,
      // so a round added meanwhile is filled, not duplicated.
      const stored = deserializeCollected(job.collected);
      const refs = roundRefs(company.rounds);
      const collected = { ...stored, existingRefs: refs, plan: planRoundWrites(refs, newAcceptedRounds(stored.validation)) };
      await writeCollected(company.row, collected, {
        db: d.db, dryRun: false, update: false, verbose: false, thresholds: BULK_THRESHOLDS,
        taxonomy: await d.taxonomy(), startupByDomain: await domainIndex(d.db), seen: null,
      }, newWriteSummary());
      const { error: refreshErr } = await d.db.rpc("refresh_startups_search");
      if (refreshErr) log(`promotion ${job.id}: search refresh failed (${refreshErr.message}) — the nightly refresh will add it`);
      await finish("written", job.startup_id, null);
      log(`promotion ${job.id}: update to ${job.startup_id} written`);
      await d.notify(job.user_id, `${job.name}: your additions are in AlphaMap`, "What your deeper research found was reviewed and added.", `/checks/${job.check_id}`);
      return true;
    }

    const existing = job.website ? await d.findExisting(job.website) : null;
    if (existing) {
      await finish("linked", existing.id, null);
      log(`promotion ${job.id}: already in AlphaMap as ${existing.name} — linked, nothing written`);
      await d.notify(job.user_id, `${job.name} is in AlphaMap`, "The company you checked is now part of AlphaMap.", `/checks/${job.check_id}`);
      return true;
    }

    const { data: startupId, error: startErr } = await d.db.rpc("start_check_promotion_write", {
      p_id: job.id, p_name: job.name, p_website: job.website,
    });
    if (startErr) throw new Error(`start_check_promotion_write: ${startErr.message}`);

    await writeCollected(freshRow(startupId as string, job.name, job.website), deserializeCollected(job.collected), {
      db: d.db, dryRun: false, update: false, verbose: false, thresholds: BULK_THRESHOLDS,
      taxonomy: await d.taxonomy(), startupByDomain: await domainIndex(d.db), seen: null,
    }, newWriteSummary());

    // The Private Market search reads a materialized view.
    const { error: refreshErr } = await d.db.rpc("refresh_startups_search");
    if (refreshErr) log(`promotion ${job.id}: search refresh failed (${refreshErr.message}) — the nightly refresh will add it`);
    await finish("written", startupId as string, null);
    log(`promotion ${job.id}: written as ${startupId}`);
    await d.notify(job.user_id, `${job.name} is in AlphaMap`, "The company you checked is now part of AlphaMap.", `/checks/${job.check_id}`);
  } catch (e) {
    log(`promotion ${job.id}: failed: ${String(e)}`);
    await finish("failed", null, String(e).slice(0, 2000));
  }
  return true;
}

/** Who owns which website domain — competitors are cross-linked by it, and no second company takes a site. */
export async function domainIndex(db: SupabaseClient): Promise<Map<string, DomainOwner>> {
  const index = new Map<string, DomainOwner>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("startups").select("id, name, website").not("website", "is", null).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`startups (domains): ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; name: string; website: string | null }>;
    for (const s of rows) {
      const dom = websiteDomain(s.website);
      if (dom && !index.has(dom)) index.set(dom, { id: s.id, name: s.name });
    }
    if (rows.length < PAGE) return index;
  }
}
