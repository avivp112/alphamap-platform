// Links that come from outside (an ATS payload, a scraped page) are shown only
// when they are web links: a javascript:, data: or relative URL is never an href.
export const safeHref = (url: string | null | undefined): string | null =>
  url && /^https?:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null;
