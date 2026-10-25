import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "fs";
import { join } from "path";

// Everything in public/ is served as-is by Vercel to anyone who knows the
// path — no sign-in, no RLS. The company lists are AlphaMap's core asset, so
// data files live in data/seed/ (read by scripts only), never in public/.
const PUBLIC_DIR = join(__dirname, "..", "public");
const DATA_FILE = /\.(csv|tsv|json|jsonl|ndjson|xlsx?|sql|parquet|db|sqlite|zip|gz)$/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("public/ holds no data files", () => {
  it("serves only media and static assets", () => {
    const leaked = walk(PUBLIC_DIR).filter((p) => DATA_FILE.test(p));
    expect(leaked).toEqual([]);
  });
});
