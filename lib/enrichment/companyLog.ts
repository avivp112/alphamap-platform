/**
 * lib/enrichment/companyLog.ts — with several companies at once (CONCURRENCY>1) their log lines would interleave. Each company's lines are gathered and
 * printed as one block when the company is done (AsyncLocalStorage follows the company through every await). With one company at a time nothing changes.
 */
import { AsyncLocalStorage } from "async_hooks";

const store = new AsyncLocalStorage<{ lines: string[] }>();
let installed = false;

export function installCompanyLog(): void {
  if (installed) return; installed = true;
  for (const k of ["log", "warn", "error", "info"] as const) {
    const real = console[k].bind(console);
    console[k] = ((...args: unknown[]) => {
      const s = store.getStore();
      if (!s) return real(...args);
      s.lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    }) as never;
  }
}

/** Runs fn with its console output gathered; returns what fn returned and the gathered lines. */
export async function gathered<T>(fn: () => Promise<T>): Promise<{ result?: T; error?: unknown; lines: string[] }> {
  const s = { lines: [] as string[] };
  try { return { result: await store.run(s, fn), lines: s.lines }; } catch (error) { return { error, lines: s.lines }; }
}


const nameStore = new AsyncLocalStorage<string>();
/** Runs fn with the company's name attached to everything it does (the recorder says which company a missing recording hurt). */
export function withCompany<T>(name: string, fn: () => Promise<T>): Promise<T> { return nameStore.run(name, fn); }
export const currentCompany = (): string => nameStore.getStore() ?? "(outside a company)";
