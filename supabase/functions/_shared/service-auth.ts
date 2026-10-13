// Is a request's bearer token the project's service role?
//
// The cron sends the key it reads from the Vault; the function compares it
// with SUPABASE_SERVICE_ROLE_KEY, which Supabase injects. Those can be two
// different strings for the same role — a legacy service_role JWT in the
// Vault and a new sb_secret_ key in the env, or two JWTs issued at different
// times — so an exact string match answered 401 to a valid key (found
// 2026-10-13). When the strings differ, the project's own Auth admin API
// decides: it accepts only service-role-grade keys.
//
// Pure apart from the injected fetch, so it is unit-tested under vitest.

export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1] : null;
}

// The "role" claim of a JWT, or null when the token is not one (sb_secret_ keys).
export function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const role = JSON.parse(atob(b64))?.role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

export async function isServiceRoleRequest(
  authorization: string | null,
  opts: { supabaseUrl: string; serviceKey: string; fetchFn?: typeof fetch },
): Promise<boolean> {
  const token = bearerToken(authorization);
  if (!token) return false;
  if (token === opts.serviceKey) return true;
  // An anon or user JWT is refused without a network call.
  const role = jwtRole(token);
  if (role !== null && role !== "service_role") return false;
  try {
    const res = await (opts.fetchFn ?? fetch)(`${opts.supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
