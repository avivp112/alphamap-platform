import type { SupabaseClient } from "@supabase/supabase-js";
import type { PeerFacts } from "./marketComparison.ts";

/** Candidates' descriptions from the database by exact (case-insensitive) name: a company on file has a website and a description. */
export function makePeerLookup(db: SupabaseClient): (names: string[]) => Promise<Map<string, PeerFacts>> {
  return async (names) => {
    const out = new Map<string, PeerFacts>();
    for (const name of names) {
      const { data } = await db.from("startups").select("name, website, description").ilike("name", name.replace(/[%_]/g, "")).not("website", "is", null).limit(1);
      const r = (data ?? [])[0] as { name: string; website: string | null; description: string | null } | undefined;
      if (r?.description?.trim() && r.website) out.set(name.toLowerCase(), { name, description: r.description, website: r.website, where: "database" });
    }
    return out;
  };
}
