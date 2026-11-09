import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";

// The first wet pilot (2026-11-09) was refused by bulk_enrich_all.ts, which bulk_enrich_v2.ts imports: the v1 gate ran
// before the v2 pilot gate could say yes. Each entry point answers with its own gate, and a wet run outside a pilot
// is still refused by both.
const run = (script: string, env: Record<string, string>) =>
  spawnSync("npx", ["tsx", script], { encoding: "utf8", timeout: 90_000, env: { ...process.env, SUPABASE_URL: "http://x.invalid", SUPABASE_SERVICE_ROLE_KEY: "k", ANTHROPIC_API_KEY: "k", ...env } });
const said = (r: ReturnType<typeof run>) => `${r.stdout}${r.stderr}`;

describe("write gate entry points", () => {
  it("v2 pilot, wet: passes the v1 import and reaches the pilot's own gate", () => {
    expect(said(run("scripts/bulk_enrich_v2.ts", { PILOT: "true", DRY_RUN: "false", ONLY: "" }))).toContain("a pilot writes a listed set of 1–25 companies");
  });
  it("v2 without a pilot, wet: refused as bulk_enrich_v2", () => {
    expect(said(run("scripts/bulk_enrich_v2.ts", { DRY_RUN: "false", PILOT: "false" }))).toContain("bulk_enrich_v2: writing is off");
  });
  it("v1 run directly, wet, even with PILOT=true: refused as bulk_enrich_all", () => {
    expect(said(run("scripts/bulk_enrich_all.ts", { DRY_RUN: "false", PILOT: "true" }))).toContain("bulk_enrich_all: writing is off");
  });
}, 300_000);
