import { describe, expect, it } from "vitest";
import { retryingFetch } from "./dbFetch.ts";

const netErr = (code?: string) => Object.assign(new TypeError("fetch failed"), code ? { cause: { code } } : {});
const mk = (script: Array<Error | number>) => { let n = 0; const real = (async () => { const s = script[n++]; if (s instanceof Error) throw s; return new Response("", { status: s as number }); }) as unknown as typeof fetch; return { real, calls: () => n }; };
const nowait = async () => {};

describe("retryingFetch", () => {
  it("tries a PATCH again after a network error and returns the answer", async () => {
    const m = mk([netErr("ECONNRESET"), netErr(), 200]);
    const res = await retryingFetch(m.real, [1, 1, 1], nowait)("https://x/rest/v1/startups", { method: "PATCH" });
    expect(res.status).toBe(200); expect(m.calls()).toBe(3);
  });
  it("tries a GET again on a 503", async () => {
    const m = mk([503, 200]);
    expect((await retryingFetch(m.real, [1, 1], nowait)("https://x/a")).status).toBe(200);
  });
  it("never repeats an insert that may have reached the server", async () => {
    const m = mk([netErr("ECONNRESET"), 201]);
    await expect(retryingFetch(m.real, [1, 1], nowait)("https://x/rest/v1/funding_rounds", { method: "POST" })).rejects.toThrow("fetch failed");
    expect(m.calls()).toBe(1);
  });
  it("repeats an insert only when the connection was never made", async () => {
    const m = mk([netErr("EAI_AGAIN"), 201]);
    expect((await retryingFetch(m.real, [1, 1], nowait)("https://x/rest/v1/field_changes", { method: "POST" })).status).toBe(201);
    expect(m.calls()).toBe(2);
  });
  it("gives up after the last wait", async () => {
    const m = mk([netErr(), netErr(), netErr()]);
    await expect(retryingFetch(m.real, [1, 1], nowait)("https://x/a")).rejects.toThrow("fetch failed");
    expect(m.calls()).toBe(3);
  });
});
