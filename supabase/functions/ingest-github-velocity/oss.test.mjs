// =============================================================================
// Offline tests for the Layer 2 ingesters (GitHub + Hugging Face).
//
// Run:  node supabase/functions/ingest-github-velocity/oss.test.mjs
//
// Neither API was reachable from the sandbox these were written in, so the
// fixtures follow each platform's documented response shape rather than a
// captured live response. They prove the mapping and filtering are correct
// against that shape — not that the shape is right.
// =============================================================================

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "oss-"));
const fns = dirname(dirname(new URL(import.meta.url).pathname));

async function load(name) {
  const src = join(fns, name, "index.ts");
  const stripped = join(dir, `${name}.ts`);
  const bundle = join(dir, `${name}.mjs`);
  const source = readFileSync(src, "utf8");
  const out = source.replace(/^import\s+.*?from\s+"https:\/\/[^"]+";\s*$/m, "");
  if (out === source) { console.error(`no remote import to strip in ${name}`); process.exit(1); }
  writeFileSync(stripped, out);
  execFileSync("npx", ["--yes", "esbuild@0.21.5", stripped, "--bundle", "--format=esm",
    `--outfile=${bundle}`, "--log-level=warning"], { stdio: "inherit" });
  return import(bundle);
}

globalThis.Deno = { serve() {}, env: { get: () => undefined } };
const GH = await load("ingest-github-velocity");
const HF = await load("ingest-huggingface");

let failed = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`PASS  ${label}`);
}

const NOW = Date.parse("2026-07-26T00:00:00Z");

// ── GitHub ──────────────────────────────────────────────────────────────────

console.log("── GitHub: search query ──");
check("query combines age, stars and OR-ed topics",
  GH.buildQuery({ topics: ["llm", "agents"], minStars: 25, maxAgeDays: 180, now: NOW }),
  "created:>2026-01-27 stars:>=25 is:public archived:false (topic:llm OR topic:agents)");
check("no topics -> no topic clause",
  GH.buildQuery({ topics: [], minStars: 50, maxAgeDays: 30, now: NOW }),
  "created:>2026-06-26 stars:>=50 is:public archived:false");
check("since date", GH.sinceDate(90, NOW), "2026-04-27");
check("search url pages",
  new URL(GH.searchUrl("x", 2)).searchParams.get("page"), "2");

console.log("\n── GitHub: repo mapping ──");
const repo = {
  full_name: "tinyco/agentkit",
  name: "agentkit",
  owner: { login: "tinyco", type: "Organization" },
  html_url: "https://github.com/tinyco/agentkit",
  homepage: "https://tinyco.dev",
  description: "An agent runtime. Join us at https://discord.gg/abc123",
  created_at: "2026-06-01T10:00:00Z",
  stargazers_count: 1240,
  forks_count: 88,
  open_issues_count: 12,
  language: "Python",
  topics: ["llm", "agents"],
  fork: false,
  archived: false,
};
const r = GH.mapRepo(repo);
check("external id", r.externalId, "tinyco/agentkit");
check("owner + type", [r.owner, r.ownerType], ["tinyco", "Organization"]);
check("counters", [r.stars, r.forks, r.openIssues], [1240, 88, 12]);
check("topics", r.topics, ["llm", "agents"]);
check("homepage", r.homepage, "https://tinyco.dev");
check("no full_name -> null", GH.mapRepo({ name: "x" }), null);
check("empty homepage becomes null", GH.mapRepo({ ...repo, homepage: "" }).homepage, null);
check("age in days", Math.round(GH.ageDays("2026-06-26T00:00:00Z", NOW)), 30);
check("null created_at -> null age", GH.ageDays(null, NOW), null);

console.log("\n── GitHub: owner profile is published fields only ──");
const user = {
  login: "ada",
  name: "Ada Okonkwo",
  html_url: "https://github.com/ada",
  blog: "https://ada.dev",
  email: "ada@tinyco.dev",
  company: "@tinyco",
  bio: "Building agents. discord.gg/xyz789",
  twitter_username: "adabuilds",
  created_at: "2019-03-02T00:00:00Z",
};
const p = GH.mapOwnerProfile(user);
check("profile fields", [p.login, p.name, p.website, p.email, p.twitter],
  ["ada", "Ada Okonkwo", "https://ada.dev", "ada@tinyco.dev", "adabuilds"]);
check("no login -> null", GH.mapOwnerProfile({ name: "x" }), null);
check("blank email stays null", GH.mapOwnerProfile({ ...user, email: "" }).email, null);
check("blank email is the DEFAULT case — most users publish none",
  GH.mapOwnerProfile({ login: "solo", html_url: "https://github.com/solo" }).email, null);

console.log("\n── GitHub: link extraction from published text ──");
check("finds discord and sites from bio, blog, description and homepage",
  GH.extractLinks(p, r),
  ["https://ada.dev", "https://discord.gg/abc123", "https://tinyco.dev", "https://discord.gg/xyz789"]);
check("no profile still mines the repo's own fields",
  GH.extractLinks(null, r), ["https://discord.gg/abc123", "https://tinyco.dev"]);
check("trailing punctuation trimmed",
  GH.extractLinks(null, { ...r, description: "see https://x.dev, thanks", homepage: null }),
  ["https://x.dev"]);

// ── Hugging Face ────────────────────────────────────────────────────────────

console.log("\n── Hugging Face: repo mapping ──");
const model = {
  id: "nova-labs/nova-1b",
  author: "nova-labs",
  createdAt: "2026-07-01T00:00:00Z",
  lastModified: "2026-07-20T00:00:00Z",
  downloads: 1850000,
  likes: 420,
  pipeline_tag: "text-generation",
  tags: ["text-generation", "llm", "license:apache-2.0", "region:us", "arxiv:2401.00001", "safetensors"],
  private: false,
};
const m = HF.mapRepo(model, "model");
check("external id", m.externalId, "nova-labs/nova-1b");
check("owner split from id", [m.owner, m.name], ["nova-labs", "nova-1b"]);
check("counters", [m.likes, m.downloads], [420, 1850000]);
check("model url", m.url, "https://huggingface.co/nova-labs/nova-1b");
check("space url is namespaced",
  HF.mapRepo({ id: "nova-labs/demo" }, "space").url, "https://huggingface.co/spaces/nova-labs/demo");
check("gated counts as unavailable", HF.mapRepo({ id: "a/b", gated: true }, "model").isPrivateOrGated, true);
check("no id -> null", HF.mapRepo({ author: "x" }, "model"), null);

console.log("\n── Hugging Face: bookkeeping tags are dropped ──");
check("keeps signal, drops namespaced noise",
  HF.usefulTags(model.tags), ["text-generation", "llm", "safetensors"]);
check("dedupes", HF.usefulTags(["llm", "llm", "agent"]), ["llm", "agent"]);
check("empty in, empty out", HF.usefulTags([]), []);

console.log("\n── Hugging Face: legacy canonical models have no org ──");
const legacy = HF.mapRepo({ id: "gpt2", downloads: 90000000, likes: 2500, tags: [] }, "model");
check("bare id yields no owner", legacy.owner, "");
check("and is filtered out as a non-startup", HF.isPersonalNamespace(legacy.owner), true);
check("a real org is not", HF.isPersonalNamespace("nova-labs"), false);

console.log("\n── Hugging Face: age filter ──");
check("age in days", Math.round(HF.ageDays("2026-06-26T00:00:00Z", NOW)), 30);
check("missing createdAt -> null, which the handler lets through",
  HF.ageDays(null, NOW), null);
check("unparseable date -> null", HF.ageDays("not-a-date", NOW), null);

console.log("\n── Hugging Face: list URL ──");
const u = new URL(HF.listUrl("model", "trendingScore", 100, 0));
check("path", u.pathname, "/api/models");
check("sort + direction", [u.searchParams.get("sort"), u.searchParams.get("direction")], ["trendingScore", "-1"]);
check("spaces path", new URL(HF.listUrl("space", "likes", 50, 10)).pathname, "/api/spaces");
check("only known sorts are accepted", [...HF.HF_SORTS].includes("trendingScore"), true);

rmSync(dir, { recursive: true, force: true });
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
