import { describe, it, expect, vi } from "vitest";
import { bearerToken, jwtRole, isServiceRoleRequest } from "./service-auth";

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: object) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.sig`;
const SERVICE_A = jwt({ iss: "supabase", ref: "zoesoyvctyjpufyqtcxf", role: "service_role", iat: 1 });
const SERVICE_B = jwt({ iss: "supabase", ref: "zoesoyvctyjpufyqtcxf", role: "service_role", iat: 2 });
const ANON = jwt({ iss: "supabase", ref: "zoesoyvctyjpufyqtcxf", role: "anon", iat: 1 });
const URL_ = "https://zoesoyvctyjpufyqtcxf.supabase.co";

const answering = (status: number) => vi.fn(async () => new Response("{}", { status }));

describe("bearerToken / jwtRole", () => {
  it("reads the token after Bearer", () => {
    expect(bearerToken(`Bearer ${SERVICE_A}`)).toBe(SERVICE_A);
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
  });
  it("reads the role claim; null for a non-JWT key", () => {
    expect(jwtRole(SERVICE_A)).toBe("service_role");
    expect(jwtRole(ANON)).toBe("anon");
    expect(jwtRole("sb_secret_abc123")).toBeNull();
  });
});

describe("isServiceRoleRequest", () => {
  it("accepts the injected key itself without a network call", async () => {
    const f = answering(500);
    expect(await isServiceRoleRequest(`Bearer ${SERVICE_A}`, { supabaseUrl: URL_, serviceKey: SERVICE_A, fetchFn: f })).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
  it("accepts a different service-role key when the Auth admin API does (Vault JWT vs injected key)", async () => {
    const f = answering(200);
    expect(await isServiceRoleRequest(`Bearer ${SERVICE_B}`, { supabaseUrl: URL_, serviceKey: SERVICE_A, fetchFn: f })).toBe(true);
    expect(await isServiceRoleRequest(`Bearer ${SERVICE_B}`, { supabaseUrl: URL_, serviceKey: "sb_secret_x", fetchFn: f })).toBe(true);
    expect(f).toHaveBeenCalledWith(`${URL_}/auth/v1/admin/users?page=1&per_page=1`, expect.anything());
  });
  it("refuses the anon key without asking", async () => {
    const f = answering(200);
    expect(await isServiceRoleRequest(`Bearer ${ANON}`, { supabaseUrl: URL_, serviceKey: SERVICE_A, fetchFn: f })).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("refuses what the Auth admin API refuses, a missing header, and a network failure", async () => {
    expect(await isServiceRoleRequest(`Bearer ${SERVICE_B}`, { supabaseUrl: URL_, serviceKey: SERVICE_A, fetchFn: answering(401) })).toBe(false);
    expect(await isServiceRoleRequest(null, { supabaseUrl: URL_, serviceKey: SERVICE_A, fetchFn: answering(200) })).toBe(false);
    const boom = vi.fn(async () => { throw new Error("network"); });
    expect(await isServiceRoleRequest(`Bearer ${SERVICE_B}`, { supabaseUrl: URL_, serviceKey: SERVICE_A, fetchFn: boom })).toBe(false);
  });
});
