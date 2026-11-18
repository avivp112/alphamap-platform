/**
 * lib/enrichment/closure.ts — the company has closed (owner, batch 6): status = closed, the date (the headline's) and the source with its quote, from the company's accepted news alone,
 * the same way as an acquisition. The company is the subject: "<Company> shuts down", "<Company> ceases operations", "<Company> winds down", "<Company> closes its doors"
 * (and the same in Polish, Spanish, Portuguese, German, French, Hebrew). A headline about shutting down something else ("Okra shuts down the old API") is not a closure.
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CLOSE = "(?:shuts? down|shut down|shutting down|is shutting down|ceases? operations?|ceased operations|winds? down|wound down|winding down|is winding down|closes? (?:its|their) doors|closed (?:its|their) doors|is closing down|will close down|closes down|goes? out of business|went out of business|is closing its doors|"
  + "cierra operaciones|cesa operaciones|cierra sus puertas|cesa sus operaciones|encerra (?:as )?atividades|encerrou (?:as )?atividades|fecha as portas|fechou as portas|zamyka działalność|kończy działalność|zawiesza działalność|"
  + "stellt den betrieb ein|schließt|schliesst|ferme ses portes|cesse son activité|cesse ses activités|סוגרת את פעילותה|מפסיקה לפעול|סוגרת את שעריה)";
const REST_OK = /^(?:\s*[:;,–—-]|\s+(?:after|as|amid|due|following|and|with|its|operations|business|for good|permanently|completely|effective|on|in|at|no|na|em|en|w|im|à)\b|\s*[.!?]|\s*$)/i;

export interface ClosureClaim { quote: string; url: string; date: string | null }

/** True when the sentence says the company itself closed. */
export function closureIn(text: string, companyName: string): boolean {
  const name = esc(companyName.trim()).replace(/\s+/g, "\\s+");
  const re = new RegExp(`(?:^|[\\s"“'‘(])${name}(?:\\s+(?:Inc\\.?|Ltd\\.?|LLC|Limited|Technologies|Labs))?[\\s,]*(?:(?:has|have|had|is|are|was|will|to|plans? to|said it will|announced it will|announces it will)\\s+)?(?:(?:announced|confirmed|announces|confirms)\\s+(?:that\\s+)?(?:it\\s+)?(?:will\\s+|is\\s+|has\\s+)?)?${CLOSE}`, "iu");
  const m = text.match(re);
  if (!m || m.index == null) return false;
  const tail = text.slice(m.index + m[0].length);
  // "Okra shuts down the old API": an object right after the verb is a thing closed, not the company.
  if (/^\s+(?:the|its|their|our|a|an|his|her)\s+\p{L}/iu.test(tail) && !/^\s+(?:its|their)\s+(?:operations|business|doors)/i.test(tail)) return false;
  return REST_OK.test(tail) || tail.length === 0;
}

/** The closure, if any, that these headlines state about the company; the newest dated one wins. */
export function detectClosure(articles: Array<{ url: string; title?: string | null; content?: string | null; date?: string | null }>, companyName: string): ClosureClaim | null {
  const claims: ClosureClaim[] = [];
  for (const a of articles) {
    const title = (a.title ?? "").trim();
    if (title.length > 12 && title.length < 300 && closureIn(title, companyName)) claims.push({ quote: title, url: a.url, date: a.date ?? null });
  }
  claims.sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
  return claims[0] ?? null;
}
