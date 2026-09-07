// Relevance rank for a text field against a free-text search query — lower
// is more relevant, 4 means no match at all. Used to keep client-side
// directory search results (VCs, Private Equity) ordered by how well they
// match what was actually typed — an exact or prefix match on the primary
// name field ranks ahead of a firm that only matched on a secondary field
// like headquarters or sector — instead of being reshuffled by whichever
// sort control the page currently has selected, which otherwise can bury
// the exact firm someone searched for beneath loosely-related results.
export function textMatchRank(value: string, query: string): number {
  const v = value.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (v === q) return 0;
  if (v.startsWith(q)) return 1;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}`).test(v)) return 2; // matches at a word boundary
  if (v.includes(q)) return 3;
  return 4;
}
