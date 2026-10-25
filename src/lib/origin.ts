// Where a company comes from, beside its headquarters (the Dealroom model;
// lib/enrichment/origin.ts writes the fields, each from a cited quote).
//
// Shown only when it ADDS something to the HQ line: "Founded in Israel" on a
// company headquartered in New York, never "Founded in Israel" under "Tel
// Aviv, Israel". Nothing is inferred here — no value, nothing shown.

const PLACEHOLDER_RE = /^\s*<?\s*(unknown|n\/?a|none|null|undefined|tbd|-|—)\s*>?\s*$/i;

const ALIASES: Record<string, string> = {
  "usa": "united states", "us": "united states", "u.s.": "united states", "united states of america": "united states",
  "uk": "united kingdom", "u.k.": "united kingdom", "great britain": "united kingdom",
};

const norm = (c: string) => {
  const n = c.trim().toLowerCase().replace(/\s+/g, " ");
  return ALIASES[n] ?? n;
};

const real = (c: string | null | undefined): c is string => !!c && !PLACEHOLDER_RE.test(c);

export interface OriginFields {
  country?: string | null;
  founding_country?: string | null;
  israel_rnd_center?: boolean | null;
}

export interface OriginFacts {
  /** The founding country, when it differs from the HQ country. */
  foundedIn: string | null;
  /** An R&D centre in Israel, for a company headquartered elsewhere. */
  rndInIsrael: boolean;
}

export function originFacts(s: OriginFields): OriginFacts {
  const hq = real(s.country) ? norm(s.country) : null;
  const founded = real(s.founding_country) ? s.founding_country.trim() : null;
  return {
    foundedIn: founded && norm(founded) !== hq ? founded : null,
    rndInIsrael: s.israel_rnd_center === true && hq !== "israel",
  };
}
