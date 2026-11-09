/**
 * lib/enrichment/sectors.ts — a sector the taxonomy agrees with itself about (owner, 2026-11-08, review 6).
 * EngFlow came out "DeepTech › DevOps / CI-CD" (DevOps belongs to SaaS & Dev Tools); Adranos "DeepTech › DeepTech /
 * General". The most specific category wins, and DeepTech is only for a company with no specific category that fits:
 *   1. the sector is the parent of the sub-sector it names;
 *   2. a "… / General" sub-sector (or none, under DeepTech) gives way to a specific sub-sector the company also names.
 */
export interface SectorFields { sector_name?: string; sub_sector_name?: string; sub_sector_names?: string[] }

const isGeneral = (sub: string | undefined) => !sub || /\/\s*general$/i.test(sub.trim());

export function reconcileSector<T extends SectorFields>(p: T, parentOf: Record<string, string> | undefined, parentNames: string[] = []): { fields: T; changes: string[] } {
  const out = { ...p, sub_sector_names: p.sub_sector_names ? [...p.sub_sector_names] : undefined };
  const changes: string[] = [];
  if (!parentOf) return { fields: out, changes };
  // 0. A sub-sector that is the name of a top-level sector ("Health & Life Sciences › Cybersecurity", review 7, x67.40)
  //    is that sector: the pair agrees with itself only if the sector is the one the sub-sector names.
  if (out.sub_sector_name && !parentOf[out.sub_sector_name] && parentNames.includes(out.sub_sector_name)) {
    if (out.sector_name !== out.sub_sector_name) changes.push(`sector ${out.sector_name ?? "(none)"} → ${out.sub_sector_name} (named as the sub-sector)`);
    out.sector_name = out.sub_sector_name;
    out.sub_sector_name = undefined;
  }
  // 2. A specific sub-sector the company also names beats a general one (and any DeepTech without a specific one).
  const generalOrNone = isGeneral(out.sub_sector_name);
  if (generalOrNone && (out.sector_name === "DeepTech" || out.sub_sector_name)) {
    const parent = out.sub_sector_name ? parentOf[out.sub_sector_name] ?? out.sector_name : out.sector_name;
    const better = (out.sub_sector_names ?? []).find((n) => parentOf[n] && !isGeneral(n) && (out.sector_name === "DeepTech" || parentOf[n] === parent));
    if (better) {
      changes.push(`sub-sector ${out.sub_sector_name ?? "(none)"} → ${better}`);
      out.sub_sector_name = better;
      out.sub_sector_names = (out.sub_sector_names ?? []).filter((n) => n !== better);
    }
  }
  // 1. The sector is the parent of the sub-sector (a specific category over a guessed parent).
  const parent = out.sub_sector_name ? parentOf[out.sub_sector_name] : undefined;
  if (parent && out.sector_name !== parent) {
    changes.push(`sector ${out.sector_name ?? "(none)"} → ${parent}`);
    out.sector_name = parent;
  }
  return { fields: out, changes };
}
