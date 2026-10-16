import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { md5Hex } from "./md5";

const nodeMd5 = (s: string) => createHash("md5").update(s).digest("hex");

describe("md5Hex", () => {
  it("matches the RFC 1321 test suite", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("12345678901234567890123456789012345678901234567890123456789012345678901234567890"))
      .toBe("57edf4a22be3c955ac49da2e2107b67a");
  });

  it("matches node's md5 — the hash scripts/backfill_embeddings.ts stores — at every padding boundary and for non-ASCII text", () => {
    const samples = [
      ...Array.from({ length: 130 }, (_, n) => "x".repeat(n)),
      "nomic-ai/nomic-embed-text-v1.5:768:Acme. Fintech. Payments for SMBs in São Paulo — 日本語 ✓ 🚀",
      "ä".repeat(8000),
    ];
    for (const s of samples) expect(md5Hex(s)).toBe(nodeMd5(s));
  });
});

// Web Crypto has no MD5 (or SHA-1 in some runtimes): the Edge Runtime throws
// "Unrecognized algorithm name". Guard every Edge Function against it.
describe("edge functions use only digests Web Crypto supports", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(f) && !/\.test\./.test(f)) files.push(p);
    }
  };
  walk(join(__dirname, ".."));

  it("no crypto.subtle.digest with MD5", () => {
    const offenders = files.filter((f) => /subtle\.digest\(\s*["'`]md5/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
