import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { releaseVersion, skipReason } from "./vercel_release_app";
import { releaseAppBundle } from "./lib/appRelease";

describe("vercel_release_app", () => {
  it("names a release by date and commit", () => {
    expect(releaseVersion("3e05f81abcdef", new Date("2026-10-16T09:41:00Z"))).toBe("web-20261016-3e05f81");
  });

  it("releases only production deploys that ask for it and can", () => {
    const prod = { VERCEL_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "k", VITE_SUPABASE_URL: "https://x.supabase.co" };
    expect(skipReason(prod)).toBeNull();
    expect(skipReason({ ...prod, VERCEL_ENV: "preview" })).toMatch(/not a production deploy/);
    expect(skipReason({ ...prod, VERCEL_GIT_COMMIT_MESSAGE: "Landing hero tweak [skip-app]" })).toMatch(/skip-app/);
    // A body that only mentions the marker is not a request to skip.
    expect(skipReason({ ...prod, VERCEL_GIT_COMMIT_MESSAGE: "Ship deploys to the app\n\nSkipped for [skip-app] commits." })).toBeNull();
    expect(skipReason({ ...prod, SUPABASE_SERVICE_ROLE_KEY: undefined })).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("bundles the app without the landing videos and data CSVs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dist-"));
    try {
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "index.html"), "<html></html>");
      writeFileSync(join(dir, "assets", "index.js"), "x".repeat(1000));
      writeFileSync(join(dir, "hero-bg.mp4"), Buffer.alloc(500_000, 1));
      writeFileSync(join(dir, "startups_list_v1.csv"), "a,b\n".repeat(100_000));
      const logs: string[] = [];
      const res = await releaseAppBundle({
        supabase: {} as never, distDir: dir, version: "t", channel: "production", platform: null,
        notes: null, dryRun: true, keep: 5, log: (m) => logs.push(m),
      });
      expect(res.status).toBe("dry_run");
      expect(res.sizeBytes).toBeLessThan(5_000);   // index.html + a compressible js file only
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
