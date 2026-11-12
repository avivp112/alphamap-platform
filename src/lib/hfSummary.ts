// What the company page shows about a company's Hugging Face organization (rpc company_hf_summary).
// Only for a company whose HF org is linked with certainty (migration 20261126000000); otherwise nothing is shown.

export interface HfSummary {
  orgs: string[];
  models: number;
  downloads: number | null;
  downloads_delta_7d: number | null;
  models_with_delta: number;
  likes: number | null;
  top_models: Array<{ name: string; url: string; downloads: number | null; likes: number | null; downloads_delta_7d: number | null }>;
  weekly: Array<{ week: string; downloads: number }>;
}

const n = (v: number) => v.toLocaleString("en-US");

/** "1,500 downloads in the last 30 days" / "+500 in 7 days" — a trend is stated only when there is a measurement to compare. */
export function hfHeadline(s: HfSummary): { downloads: string | null; trend: string | null; models: string } {
  const trend = s.downloads_delta_7d == null || s.models_with_delta === 0
    ? null
    : `${s.downloads_delta_7d >= 0 ? "+" : "−"}${n(Math.abs(s.downloads_delta_7d))} in 7 days${s.models_with_delta < s.models ? ` (${s.models_with_delta} of ${s.models} models measured)` : ""}`;
  return {
    models: `${s.models} model${s.models === 1 ? "" : "s"}`,
    downloads: s.downloads == null ? null : `${n(s.downloads)} downloads in the last 30 days`,
    trend,
  };
}

/** The weekly series is drawn only with two or more weeks; one week is a level, not a trend. */
export const hfHasTrend = (s: HfSummary): boolean => s.weekly.length >= 2;

export function hfOrgUrl(org: string): string {
  return `https://huggingface.co/${encodeURIComponent(org)}`;
}
