// The company_checks queue, through the lease-guarded RPCs of migration
// 20261021010000 / 20261022000000. Every write after the claim names this worker; a run
// whose lease was taken over cannot overwrite the newer one.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CheckRow {
  id: string;
  user_id: string;
  input: { name: string; website: string | null; host: string | null; country: string | null;
           founder: string | null; linkedin: string | null; sector: string | null };
  status: string;
  /** identify = the short search for the company; check = the threshold checks (migration 20261022000000). */
  phase: "identify" | "check";
  attempts: number;
  max_attempts: number;
}

export interface Usage {
  duration_ms?: number;
  cost_usd?: number;
  search_calls?: number;
  llm_input_tokens?: number;
  llm_output_tokens?: number;
}

export class Queue {
  constructor(private db: SupabaseClient, private workerId: string, private leaseSeconds: number) {}

  async claim(): Promise<CheckRow | null> {
    const { data, error } = await this.db.rpc("claim_company_check", { p_worker: this.workerId, p_lease_seconds: this.leaseSeconds });
    if (error) throw new Error(`claim_company_check: ${error.message}`);
    // A composite-returning function gives an all-null row when nothing was claimed.
    return data && (data as CheckRow).id ? (data as CheckRow) : null;
  }

  async heartbeat(id: string): Promise<boolean> {
    const { data, error } = await this.db.rpc("heartbeat_company_check", { p_id: id, p_worker: this.workerId, p_lease_seconds: this.leaseSeconds });
    if (error) throw new Error(`heartbeat_company_check: ${error.message}`);
    return data === true;
  }

  async patch(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await this.db.rpc("patch_company_check", { p_id: id, p_worker: this.workerId, p_patch: patch });
    if (error) throw new Error(`patch_company_check: ${error.message}`);
    return data === true;
  }

  async finish(id: string, status: string, patch: Record<string, unknown> & Usage, error: string | null = null): Promise<boolean> {
    const { data, error: e } = await this.db.rpc("finish_company_check", {
      p_id: id, p_worker: this.workerId, p_status: status, p_patch: patch, p_error: error, p_retry_in_seconds: null,
    });
    if (e) throw new Error(`finish_company_check: ${e.message}`);
    return data === true;
  }

  async retryLater(id: string, seconds: number, error: string, usage: Usage): Promise<boolean> {
    const { data, error: e } = await this.db.rpc("finish_company_check", {
      p_id: id, p_worker: this.workerId, p_status: "queued", p_patch: usage, p_error: error, p_retry_in_seconds: seconds,
    });
    if (e) throw new Error(`finish_company_check (retry): ${e.message}`);
    return data === true;
  }

  /** Back to the queue WITHOUT using an attempt — for a key of ours that a provider rejected. */
  async release(id: string, seconds: number, note: string, usage: Usage): Promise<boolean> {
    const { data, error: e } = await this.db.rpc("release_company_check", {
      p_id: id, p_worker: this.workerId, p_retry_in_seconds: seconds, p_note: note, p_usage: usage,
    });
    if (e) throw new Error(`release_company_check: ${e.message}`);
    return data === true;
  }

  /** The AlphaMap company at this website, if any (find_existing_startup, by registrable domain). */
  async findExisting(website: string): Promise<{ id: string; name: string } | null> {
    const { data, error } = await this.db.rpc("find_existing_startup", { p_website: website, p_linkedin: null });
    if (error) throw new Error(`find_existing_startup: ${error.message}`);
    const hit = Array.isArray(data) ? data[0] : null;
    return hit ? { id: hit.id, name: hit.name } : null;
  }

  /** Facts about investors from AlphaMap's own rounds (migration 20261023000000). */
  async investorFacts(names: string[]): Promise<Array<{ name: string; investor_id: string | null; investor_name: string | null;
    companies: number; rounds: number; rounds_led: number; main_stages: string[] }>> {
    if (names.length === 0) return [];
    const { data, error } = await this.db.rpc("investor_facts", { p_names: names });
    if (error) throw new Error(`investor_facts: ${error.message}`);
    return (data ?? []) as Awaited<ReturnType<Queue["investorFacts"]>>;
  }

  /** The owner's bell. Private: one row for the user who asked, nobody else. */
  async notify(userId: string, title: string, body: string, link: string): Promise<void> {
    const { error } = await this.db.from("notifications").insert({ user_id: userId, type: "company_check", title, body, link });
    if (error) console.error(`[worker] notification failed: ${error.message}`);
  }

  /** One row per on-demand run in the shared cost log (service-role only table). */
  async logRun(checkId: string, model: string, usage: Required<Usage>): Promise<void> {
    const { error } = await this.db.from("enrichment_runs").insert({
      pipeline: "v2", run_kind: "on_demand", check_id: checkId, dry_run: false,
      profile_model: model, finished_at: new Date().toISOString(), companies_count: 1,
      total_cost_usd: usage.cost_usd, duration_ms: usage.duration_ms, search_calls: usage.search_calls,
      llm_input_tokens: usage.llm_input_tokens, llm_output_tokens: usage.llm_output_tokens,
    });
    if (error) console.error(`[worker] enrichment_runs insert failed: ${error.message}`);
  }
}
