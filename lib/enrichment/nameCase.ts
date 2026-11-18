/** A company name written in capitals ("MICROSOFT") is written as a name ("Microsoft"); short acronyms (IBM, SAP, AWS) and mixed case stay (owner, batch 7). */
export function caseName(name: string): string {
  const n = name.trim();
  const letters = n.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4 || n !== n.toUpperCase() || n === n.toLowerCase()) return n;
  return n.toLowerCase().replace(/(^|[\s\-/&.])(\p{L})/gu, (_m, a: string, b: string) => `${a}${b.toUpperCase()}`);
}
