/**
 * lib/enrichment/sectorCache.ts — one answer per (company, description, classifier version) for the marks' rejudge (owner, 2026-11-12).
 * The model does not answer the same way twice on a borderline company (DataRails: ERP / Finance, then Fintech Infrastructure; Kitov:
 * Industrial Automation, then Computer Vision; Gloat: HR Tech, then AI Agents), so every rejudge produced "changed" values nobody had
 * marked, and the sector field never settled. The rejudge now asks the model once per description and classifier version and reuses the
 * answer; a change to the definitions, the rules or the model is a new version and asks again. The collection itself does not use it.
 */
import { createHash } from "node:crypto";
import { SECTOR_DEFINITIONS, SECTOR_RULES } from "./sectorDefinitions.ts";

export const SECTOR_CACHE = "eval/sector_classifications.json";
const sha = (s: string) => createHash("sha1").update(s).digest("hex");

/** The classifier's version: its definitions, rules and model. */
export const classifierVersion = (model: string): string => sha(JSON.stringify([SECTOR_DEFINITIONS, SECTOR_RULES, model])).slice(0, 12);
export const cacheKey = (version: string, company: string, description: string): string => sha(`${version}|${company}|${description}`);

export interface SectorCacheFile { version: string; entries: Record<string, string | null> }
/** Entries of an older version are dropped: the file holds the current version only. */
export function currentEntries(file: SectorCacheFile | null | undefined, version: string): Map<string, string | null> {
  return new Map(file && file.version === version ? Object.entries(file.entries) : []);
}
export const toCacheFile = (version: string, entries: Map<string, string | null>): SectorCacheFile => ({ version, entries: Object.fromEntries(entries) });
