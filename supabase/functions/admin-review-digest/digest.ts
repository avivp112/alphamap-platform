// Pure builder for the weekly review-queue email — no Deno or network, so
// vitest runs it in Node (digest.test.ts).

export interface ReviewSummary {
  pending: number;
  pending_alert: number;
  pending_queue: number;
  by_source: Record<string, number>;
  new_24h: number;
  new_7d: number;
  approved_7d: number;
  rejected_7d: number;
  oldest_pending_at: string | null;
  top: Array<{ name: string; source: string; tier: "alert" | "queue"; first_seen_at: string }>;
  admin_emails: string[];
}

const SOURCE: Record<string, string> = {
  sec_form_d: "SEC Form D",
  uk_companies_house: "UK Companies House",
  epo_ops: "EPO patents",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Whole days between `iso` and `now`; null when there is no date. */
export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/**
 * The review link. Only when SITE_URL is configured — the email never guesses
 * the deployed domain (same rule as crm-webhook-sync).
 */
export function reviewUrl(siteUrl: string | undefined): string | null {
  const base = siteUrl?.trim().replace(/\/+$/, "");
  if (!base || !/^https:\/\/[^\s/]+/.test(base)) return null;
  return `${base}/admin/review`;
}

export function buildDigest(s: ReviewSummary, opts: { now: Date; siteUrl?: string; test?: boolean }): { subject: string; html: string } {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const subject = s.pending > 0
    ? `[AlphaMap] ${plural(s.pending, "company is", "companies are")} waiting for your review`
    : "[AlphaMap] Review queue is empty";

  const oldest = daysSince(s.oldest_pending_at, opts.now);
  const sources = Object.entries(s.by_source)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${escapeHtml(SOURCE[k] ?? k)}: ${n}`)
    .join(" · ");
  const link = reviewUrl(opts.siteUrl);

  const rows = s.top.map((c) =>
    `<tr><td style="padding:4px 12px 4px 0"><strong>${escapeHtml(c.name)}</strong></td>` +
    `<td style="padding:4px 12px 4px 0;color:#6b7280">${escapeHtml(SOURCE[c.source] ?? c.source)}</td>` +
    `<td style="padding:4px 0;color:${c.tier === "alert" ? "#047857" : "#b45309"}">${c.tier === "alert" ? "alerted users" : "review only"}</td></tr>`,
  ).join("");

  const html = [
    opts.test ? "<p><strong>Test email</strong> — sent on request to confirm the weekly reminder reaches this inbox.</p>" : "",
    s.pending > 0
      ? `<p><strong>${plural(s.pending, "company is", "companies are")}</strong> waiting for review: ${s.pending_alert} already alerted users, ${s.pending_queue} review-only.${oldest !== null && oldest >= 1 ? ` The oldest has waited ${plural(oldest, "day", "days")}.` : ""}</p>`
      : "<p>Nothing is waiting for review.</p>",
    sources ? `<p style="color:#6b7280">${sources}</p>` : "",
    `<p>This week: ${s.new_7d} found, ${s.approved_7d} approved, ${s.rejected_7d} rejected.</p>`,
    rows ? `<p style="margin-top:16px"><strong>Look at first</strong></p><table style="border-collapse:collapse;font-size:14px">${rows}</table>` : "",
    link
      ? `<p style="margin-top:20px"><a href="${escapeHtml(link)}" style="background:#0f172a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open the review queue</a></p>`
      : `<p style="margin-top:20px">Open AlphaMap → account menu → <strong>Review queue</strong>.</p>`,
  ].filter(Boolean).join("\n");

  return { subject: opts.test ? `${subject} (test)` : subject, html };
}
