#!/usr/bin/env node
/**
 * generate_training_schema.ts — dataset extraction pipeline for fine-tuning
 * our self-hosted model (Qwen 2.5 Coder 14B via QLoRA/Unsloth) on this
 * project's actual Supabase schema and financial-analysis logic. Step 1 of
 * the roadmap: schema -> system prompt -> JSONL dataset (this script) ->
 * fine-tune -> vLLM deploy (already wired on the serving side — see
 * supabase/functions/_shared/llm-client.ts, which talks to an
 * OpenAI-compatible self-hosted endpoint).
 *
 * Two files this maintains, kept deliberately separate:
 *
 *   dataset/seed_examples.jsonl
 *     Hand-curated + seeded {category, question, response} training pairs
 *     — no system prompt embedded. Grows via the `add` subcommand; `generate`
 *     never overwrites it (seeded with a starter set only if it doesn't
 *     exist yet).
 *
 *   dataset/schema_training.jsonl
 *     The actual training file, in the standard
 *     {"messages":[{role:"system"},{role:"user"},{role:"assistant"}]} shape
 *     one QLoRA/Unsloth (and most fine-tuning frameworks) expect. Every row
 *     shares the SAME system prompt — built fresh from the live schema on
 *     every `generate` run — combined with one seed example each. This
 *     split means a schema change (a new column, a renamed table) updates
 *     every training row automatically, without hand-editing a large JSONL
 *     file or re-typing the system prompt into every example.
 *
 * Usage:
 *   npx tsx scripts/generate_training_schema.ts generate
 *     Connects to Postgres, extracts the public schema, rebuilds the system
 *     prompt, and writes dataset/schema_training.jsonl from every seed
 *     example on file (seeding dataset/seed_examples.jsonl with the starter
 *     set first, if it doesn't exist yet).
 *
 *   npx tsx scripts/generate_training_schema.ts add \
 *     --category text_to_sql \
 *     --question "Which fintech startups raised a Series A in the last 90 days?" \
 *     --response "SELECT name, latest_valuation, latest_round_date FROM startups_search WHERE sector_parent = 'Fintech' AND latest_round_type = 'Series A' AND latest_round_date >= CURRENT_DATE - INTERVAL '90 days' ORDER BY latest_round_date DESC;"
 *     Appends one example to dataset/seed_examples.jsonl. --category must be
 *     "text_to_sql" or "financial_analysis". Run `generate` afterward to
 *     fold it into schema_training.jsonl — `add` itself never touches the
 *     database, so it's instant and needs no DB credentials.
 *
 *   npx tsx scripts/generate_training_schema.ts list
 *     Prints every seed example on file (index, category, question).
 *
 * Requires SUPABASE_DB_URL for `generate` only (direct Postgres connection
 * string — Supabase Dashboard -> Project Settings -> Database -> Connection
 * string -> URI) — the same variable this repo's migrate-database CI job
 * already uses. `add` and `list` need no database connection at all.
 */

import { Client } from "pg";
import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Bootstrap: load .env for local dev (same pattern as bulk_enrich_all.ts) ──
const __dir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dir, "..");
const envPath = join(rootDir, ".env");
if (existsSync(envPath)) config({ path: envPath });

const DATASET_DIR = join(rootDir, "dataset");
const SEED_PATH = join(DATASET_DIR, "seed_examples.jsonl");
const OUTPUT_PATH = join(DATASET_DIR, "schema_training.jsonl");

// ── Types ─────────────────────────────────────────────────────────────────────

interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
}

interface ForeignKeyInfo {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

interface TableInfo {
  name: string;
  kind: "table" | "view" | "materialized_view";
  comment: string | null;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
}

type ExampleCategory = "text_to_sql" | "financial_analysis";
const VALID_CATEGORIES: ExampleCategory[] = ["text_to_sql", "financial_analysis"];

interface SeedExample {
  category: ExampleCategory;
  question: string;
  response: string;
}

interface TrainingRow {
  messages: [
    { role: "system"; content: string },
    { role: "user"; content: string },
    { role: "assistant"; content: string },
  ];
}

// ── Starter seed set — grounded in this project's real schema (startups_search,
// investors, headcount_history, etc.), not generic placeholders. `generate`
// writes this to seed_examples.jsonl only the first time it's run (the file
// doesn't exist yet); after that, seed_examples.jsonl is the source of truth
// and this constant is never consulted again. ────────────────────────────────
const STARTER_SEED_EXAMPLES: SeedExample[] = [
  {
    category: "text_to_sql",
    question: "Which fintech startups raised a Series A in the last 90 days?",
    response:
      "SELECT name, latest_valuation, latest_round_date\n" +
      "FROM startups_search\n" +
      "WHERE sector_parent = 'Fintech'\n" +
      "  AND latest_round_type = 'Series A'\n" +
      "  AND latest_round_date >= CURRENT_DATE - INTERVAL '90 days'\n" +
      "ORDER BY latest_round_date DESC;",
  },
  {
    category: "text_to_sql",
    question: "Find AI & ML companies in Israel with more than 50 employees and rapid growth.",
    response:
      "SELECT name, employee_count, growth_trend, city\n" +
      "FROM startups_search\n" +
      "WHERE sector_parent = 'AI & ML'\n" +
      "  AND country = 'Israel'\n" +
      "  AND employee_count > 50\n" +
      "  AND growth_trend = 'rapid growth'\n" +
      "ORDER BY employee_count DESC;",
  },
  {
    category: "text_to_sql",
    question: "List the 10 most recently funded startups across all sectors.",
    response:
      "SELECT name, sector_parent, latest_round_type, latest_valuation, latest_round_date\n" +
      "FROM startups_search\n" +
      "WHERE latest_round_date IS NOT NULL\n" +
      "ORDER BY latest_round_date DESC\n" +
      "LIMIT 10;",
  },
  {
    category: "text_to_sql",
    question: "Which seed-stage VC firms have a portfolio of more than 20 companies?",
    response:
      "SELECT name, portfolio_size, headquarters, fund_size\n" +
      "FROM investors\n" +
      "WHERE 'Seed' = ANY(stages)\n" +
      "  AND portfolio_size > 20\n" +
      "ORDER BY portfolio_size DESC;",
  },
  {
    category: "text_to_sql",
    question: "Show companies whose headcount has been shrinking over their last two recorded snapshots.",
    response:
      "WITH ranked AS (\n" +
      "  SELECT company_id, headcount, snapshot_date,\n" +
      "         ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY snapshot_date DESC) AS rn\n" +
      "  FROM headcount_history\n" +
      ")\n" +
      "SELECT s.name, latest.headcount AS current_headcount, prior.headcount AS prior_headcount\n" +
      "FROM ranked latest\n" +
      "JOIN ranked prior ON prior.company_id = latest.company_id AND prior.rn = 2\n" +
      "JOIN startups s ON s.id = latest.company_id\n" +
      "WHERE latest.rn = 1 AND latest.headcount < prior.headcount;",
  },
  {
    category: "text_to_sql",
    question: "Which startups in the database have no news coverage on file at all?",
    response:
      "SELECT name, sector_parent, country\n" +
      "FROM startups_search\n" +
      "WHERE news IS NULL OR jsonb_array_length(news) = 0;",
  },
  {
    category: "financial_analysis",
    question: "How should I interpret a startup with a high peer_count but a low completeness_score?",
    response:
      "A high peer_count means this company sits in a crowded segment — many comparable startups exist in the same " +
      "sector/stage bucket, which is useful context for relative valuation but also signals more competition for " +
      "capital and customers. A low completeness_score means AlphaMap's own profile for this company is thin — " +
      "several expected fields (funding history, description, leadership, etc.) are still missing or unverified. " +
      "Together, this combination means: don't treat the company's current metrics as a complete picture yet — " +
      "prioritize it for enrichment before drawing conclusions from what's on file, and treat any comparison against " +
      "its (better-documented) peers with appropriate caution.",
  },
  {
    category: "financial_analysis",
    question: "What does it mean when has_recent_round is true but growth_trend is 'stable' rather than 'rapid growth'?",
    response:
      "It means the company closed a funding round recently (has_recent_round looks at latest_round_date against a " +
      "recency window) but its headcount trajectory hasn't accelerated to match — growth_trend is derived " +
      "separately, from actual headcount movement over time, not from the funding event itself. This combination is " +
      "worth flagging rather than ignoring: it can indicate the round was raised for runway/efficiency rather than " +
      "aggressive scaling, a later-than-usual hiring ramp, or simply that headcount data hasn't caught up yet. It " +
      "should not be read as a red flag on its own — funding recency and headcount growth are independent signals, " +
      "and conflating them risks penalizing a deliberately capital-efficient company.",
  },
  {
    category: "financial_analysis",
    question: "Two companies have the same total_raised. What else should I check before treating them as comparable?",
    response:
      "total_raised alone doesn't establish comparability. At minimum, also check: (1) latest_valuation and " +
      "latest_round_type — the same total raised across a different number/size of rounds implies very different " +
      "dilution and momentum; (2) employee_count and growth_trend — capital efficiency (raised per employee, or per " +
      "unit of headcount growth) varies enormously even at equal totals; (3) sector_parent and peer_count — the same " +
      "dollar amount means something different in capital-intensive sectors (e.g. hardware, biotech) versus " +
      "capital-light ones (e.g. SaaS); (4) latest_round_date — a company that raised the same total more recently is " +
      "in a different position than one whose last round was years ago, even at an identical cumulative figure.",
  },
];

// ── Schema extraction ────────────────────────────────────────────────────────
// Standard information_schema / pg_catalog introspection — covers ordinary
// tables, views, AND materialized views (relkind 'r'/'v'/'m'), since several
// of this project's *_search materialized views (e.g. startups_search) are
// the actual query target for most read-heavy questions, not their base
// tables — the system prompt below explicitly steers the model toward them.
async function extractSchema(client: Client): Promise<TableInfo[]> {
  const tablesRes = await client.query<{ table_name: string; relkind: string; table_comment: string | null }>(`
    SELECT c.relname AS table_name, c.relkind, obj_description(c.oid, 'pg_class') AS table_comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'v', 'm')
    ORDER BY c.relname;
  `);

  const kindMap: Record<string, TableInfo["kind"]> = { r: "table", v: "view", m: "materialized_view" };
  const tables: TableInfo[] = [];

  for (const row of tablesRes.rows) {
    const tableName = row.table_name;

    const columnsRes = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: boolean;
      column_default: string | null;
      is_primary_key: boolean;
    }>(
      `
      SELECT
        col.column_name,
        col.data_type,
        (col.is_nullable = 'YES') AS is_nullable,
        col.column_default,
        EXISTS (
          SELECT 1
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name = $1
            AND kcu.column_name = col.column_name
        ) AS is_primary_key
      FROM information_schema.columns col
      WHERE col.table_schema = 'public' AND col.table_name = $1
      ORDER BY col.ordinal_position;
      `,
      [tableName],
    );

    const fkRes = await client.query<{ column_name: string; references_table: string; references_column: string }>(
      `
      SELECT
        kcu.column_name,
        ccu.table_name AS references_table,
        ccu.column_name AS references_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1;
      `,
      [tableName],
    );

    tables.push({
      name: tableName,
      kind: kindMap[row.relkind] ?? "table",
      comment: row.table_comment,
      columns: columnsRes.rows.map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        isNullable: c.is_nullable,
        isPrimaryKey: c.is_primary_key,
        defaultValue: c.column_default,
      })),
      foreignKeys: fkRes.rows.map((f) => ({
        column: f.column_name,
        referencesTable: f.references_table,
        referencesColumn: f.references_column,
      })),
    });
  }

  return tables;
}

// ── System prompt formatter ─────────────────────────────────────────────────
// Markdown, optimized for Text-to-SQL + financial-analysis: one heading per
// table, columns as a flat bullet list (type + PK/NOT NULL flags), foreign
// keys called out separately so join paths are unambiguous at a glance.
function formatSystemPrompt(tables: TableInfo[]): string {
  const schemaSection = tables
    .map((t) => {
      const kindLabel = t.kind === "materialized_view" ? " (materialized view)" : t.kind === "view" ? " (view)" : "";
      const comment = t.comment ? `\n> ${t.comment}` : "";
      const cols = t.columns
        .map((c) => {
          const flags = [c.isPrimaryKey && "PK", !c.isNullable && "NOT NULL"].filter(Boolean).join(", ");
          return `- \`${c.name}\`: ${c.dataType}${flags ? ` (${flags})` : ""}`;
        })
        .join("\n");
      const fks = t.foreignKeys.length
        ? "\n\nForeign keys:\n" + t.foreignKeys.map((f) => `- \`${f.column}\` → \`${f.referencesTable}.${f.referencesColumn}\``).join("\n")
        : "";
      return `### ${t.name}${kindLabel}${comment}\n\n${cols}${fks}`;
    })
    .join("\n\n");

  return `You are a PostgreSQL and financial-analysis expert embedded in AlphaMap, a private-markets intelligence platform. You translate natural-language questions from investors and analysts into precise, efficient PostgreSQL queries against the schema below, and you reason about the platform's own companies, investors, and scoring signals when asked to explain or interpret them.

## Database Schema (public schema, extracted live from Supabase)

${schemaSection}

## Rules
- Only reference tables and columns that actually appear above — never invent a column or table name.
- For read-heavy analytical questions, prefer a \`_search\` materialized view (e.g. \`startups_search\`) over its base table when one exists for the entity you're querying — these pre-join and pre-compute fields the base table doesn't have directly.
- When asked for a query, return ONLY the SQL unless explicitly asked to also explain it.
- When asked about a company, investor, or scoring signal, ground your answer strictly in fields that exist in this schema — never invent a metric, threshold, or formula that isn't backed by a real column.
- If a question can't be answered from this schema, say so plainly rather than guessing.`;
}

// ── Seed examples: read / append ────────────────────────────────────────────

function readSeedExamples(): SeedExample[] {
  if (!existsSync(SEED_PATH)) return [];
  return readFileSync(SEED_PATH, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SeedExample);
}

function writeSeedExamplesJsonl(examples: SeedExample[]): void {
  mkdirSync(DATASET_DIR, { recursive: true });
  writeFileSync(SEED_PATH, examples.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function appendSeedExample(example: SeedExample): void {
  mkdirSync(DATASET_DIR, { recursive: true });
  appendFileSync(SEED_PATH, JSON.stringify(example) + "\n");
}

// ── generate ─────────────────────────────────────────────────────────────────

async function runGenerate(): Promise<void> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("❌  SUPABASE_DB_URL is not set — see this script's header comment for where to find it.");
    process.exit(1);
  }

  if (!existsSync(SEED_PATH)) {
    console.log(`No seed examples on file yet — seeding ${STARTER_SEED_EXAMPLES.length} starter examples at ${SEED_PATH}`);
    writeSeedExamplesJsonl(STARTER_SEED_EXAMPLES);
  }

  console.log("Connecting to Postgres…");
  // Supabase's connection pooler terminates TLS with a cert chain Node's
  // default CA bundle doesn't always have — same accommodation psql's own
  // defaults make. This is a direct, service-role-equivalent DB connection
  // (the same SUPABASE_DB_URL used for schema migrations), not a
  // user-facing one, so relaxing certificate verification here is the same
  // trust boundary this repo already accepts for that job.
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let tables: TableInfo[];
  try {
    console.log("Extracting schema (tables, columns, primary/foreign keys)…");
    tables = await extractSchema(client);
  } finally {
    await client.end();
  }
  console.log(`Found ${tables.length} tables/views in the public schema.`);

  const systemPrompt = formatSystemPrompt(tables);
  const examples = readSeedExamples();
  console.log(`Building ${examples.length} training rows from dataset/seed_examples.jsonl…`);

  const rows: TrainingRow[] = examples.map((ex) => ({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: ex.question },
      { role: "assistant", content: ex.response },
    ],
  }));

  mkdirSync(DATASET_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const byCategory = examples.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n✅  Wrote ${rows.length} rows to ${OUTPUT_PATH}`);
  console.log(`   By category: ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);
  console.log(`   System prompt: ${systemPrompt.length.toLocaleString()} chars, ${tables.length} tables/views.`);
}

// ── add ──────────────────────────────────────────────────────────────────────

function runAdd(flags: Record<string, string>): void {
  const category = flags.category as ExampleCategory | undefined;
  const question = flags.question;
  const response = flags.response;

  if (!category || !VALID_CATEGORIES.includes(category)) {
    console.error(`❌  --category is required and must be one of: ${VALID_CATEGORIES.join(", ")}`);
    process.exit(1);
  }
  if (!question?.trim()) {
    console.error("❌  --question is required and must not be empty.");
    process.exit(1);
  }
  if (!response?.trim()) {
    console.error("❌  --response is required and must not be empty.");
    process.exit(1);
  }

  appendSeedExample({ category, question: question.trim(), response: response.trim() });
  console.log(`✅  Appended a "${category}" example to ${SEED_PATH}`);
  console.log(`   Run \`npx tsx scripts/generate_training_schema.ts generate\` to fold it into ${OUTPUT_PATH}.`);
}

// ── list ─────────────────────────────────────────────────────────────────────

function runList(): void {
  const examples = readSeedExamples();
  if (examples.length === 0) {
    console.log(`No seed examples yet at ${SEED_PATH}. Run \`generate\` once to seed the starter set, or \`add\` to add your own.`);
    return;
  }
  console.log(`${examples.length} seed examples in ${SEED_PATH}:\n`);
  examples.forEach((e, i) => {
    const preview = e.question.length > 90 ? e.question.slice(0, 87) + "…" : e.question;
    console.log(`  [${i}] (${e.category}) ${preview}`);
  });
}

// ── CLI entry point ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command: command ?? "generate", flags };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "generate":
      await runGenerate();
      break;
    case "add":
      runAdd(flags);
      break;
    case "list":
      runList();
      break;
    default:
      console.error(`❌  Unknown command "${command}". Expected one of: generate, add, list.`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error("❌  Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
