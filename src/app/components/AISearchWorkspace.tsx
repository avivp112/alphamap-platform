import React, { useCallback, useRef, useState } from "react";
import {
  Search, Sparkles, ArrowRight, X, Building2, Landmark,
  MapPin, TrendingUp, AlertCircle, Loader2, CornerDownLeft,
} from "lucide-react";
import { CompanyLogo } from "./CompanyLogo";
import { semanticSearch, type SemanticMatch, type SemanticSearchResult } from "../../lib/semanticSearch";

// ─────────────────────────────────────────────────────────────────────────────
// AISearchWorkspace — the AI Search Engine hero for the Market Intelligence
// home. A prominent semantic-search input (Perplexity / Glean / Raycast in
// feel) wired to the Phase 1 `semanticSearch` utility. Results render inline
// beneath the bar, split into Companies and Investors, using the platform's
// existing card language (white cards, gray-100 borders, CompanyLogo).
//
// Fails gracefully by design: the embeddings backfill and the Edge Function's
// OpenAI key may not be in place yet, so any transport/function error shows a
// calm "Service initializing" state, and a successful-but-empty response shows
// "No results found" — the page never crashes on a search.
// ─────────────────────────────────────────────────────────────────────────────

const EXAMPLE_QUERIES = [
  "European Series A cybersecurity startups with stable headcount",
  "AI infrastructure companies scaling fast",
  "Growth-stage fintech investors in the US",
  "Climate hardware startups founded after 2020",
];

type Status = "idle" | "loading" | "done" | "error";

// Defensive readers for the loosely-typed `metadata` jsonb.
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
const FIRM_TYPE_LABEL: Record<string, string> = { vc: "VC", pe: "Private Equity", growth: "Growth" };

export function AISearchWorkspace() {
  const [query, setQuery]       = useState("");
  const [status, setStatus]     = useState<Status>("idle");
  const [result, setResult]     = useState<SemanticSearchResult | null>(null);
  const [ranQuery, setRanQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setStatus("loading");
    setRanQuery(q);
    setResult(null);
    try {
      const res = await semanticSearch(q, { matchCount: 12, matchThreshold: 0.2 });
      setResult(res);
      setStatus("done");
    } catch {
      // Edge Function not deployed / OpenAI key missing / network — all land here.
      setStatus("error");
    }
  }, []);

  const clear = () => {
    setQuery("");
    setStatus("idle");
    setResult(null);
    setRanQuery("");
    inputRef.current?.focus();
  };

  const companies = result?.matches.filter(m => m.entity_type === "startup") ?? [];
  const investors = result?.matches.filter(m => m.entity_type === "investor") ?? [];
  const showPanel = status !== "idle";

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-gray-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      {/* soft ambient wash behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -20%, rgba(124,137,103,0.10) 0%, rgba(124,137,103,0) 55%), radial-gradient(90% 60% at 90% 0%, rgba(245,158,11,0.06) 0%, rgba(245,158,11,0) 50%)",
        }}
      />

      <div className="relative px-5 py-10 sm:px-8 sm:py-12 lg:py-14">
        {/* Eyebrow */}
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-[11px] font-semibold text-gray-500 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-[#7C8967]" />
            AlphaMap Intelligence
          </div>
        </div>

        {/* Headline */}
        <h1 className="mx-auto mt-4 max-w-2xl text-center text-2xl font-bold tracking-tight text-[#0F172A] sm:text-[32px] sm:leading-[1.15]">
          Ask anything about the private markets
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-gray-500">
          Search companies and investors in natural language — grounded strictly in the AlphaMap database.
        </p>

        {/* Search input */}
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
          className="mx-auto mt-7 max-w-2xl"
        >
          <div className="group relative flex items-center rounded-[18px] border border-gray-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition-all focus-within:border-[#0F172A]/30 focus-within:shadow-[0_12px_40px_rgba(15,23,42,0.10)] focus-within:ring-4 focus-within:ring-[#0F172A]/[0.06]">
            <Search className="ml-4 h-5 w-5 flex-none text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find me European Series A cybersecurity startups with stable headcount…"
              className="w-full bg-transparent px-3 py-4 text-[15px] text-[#0F172A] placeholder:text-gray-400 focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                onClick={clear}
                className="mr-1 flex-none rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={!query.trim() || status === "loading"}
              className="m-1.5 flex flex-none items-center gap-1.5 rounded-[13px] bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span className="hidden sm:inline">Search</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>

          {/* Example query chips */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLE_QUERIES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => { setQuery(ex); runSearch(ex); }}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition-all hover:border-gray-300 hover:text-[#0F172A]"
              >
                {ex}
              </button>
            ))}
          </div>
        </form>

        {/* Results / states */}
        {showPanel && (
          <div className="mx-auto mt-8 max-w-3xl">
            {status === "loading" && <ResultsSkeleton />}

            {status === "error" && (
              <StatePanel
                icon={<Loader2 className="h-5 w-5 text-amber-500" />}
                title="Service initializing"
                body="The AI search engine is still coming online (embeddings backfill and API keys are being configured). Please try again shortly."
              />
            )}

            {status === "done" && result && result.matches.length === 0 && (
              <StatePanel
                icon={<Search className="h-5 w-5 text-gray-400" />}
                title="No results found"
                body={`We couldn't find companies or investors matching “${ranQuery}”. Try broadening the query or different terms.`}
              />
            )}

            {status === "done" && result && result.matches.length > 0 && (
              <div className="space-y-6 text-left">
                <p className="text-center text-xs text-gray-400">
                  {result.matches.length} {result.matches.length === 1 ? "result" : "results"} for “{ranQuery}”
                </p>

                {companies.length > 0 && (
                  <ResultGroup
                    icon={Building2}
                    title="Companies"
                    count={companies.length}
                    items={companies}
                  />
                )}

                {investors.length > 0 && (
                  <ResultGroup
                    icon={Landmark}
                    title="Investors"
                    count={investors.length}
                    items={investors}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* subtle keyboard hint, only when nothing is happening */}
      {status === "idle" && (
        <div className="relative flex items-center justify-center gap-1.5 border-t border-gray-100 py-2.5 text-[11px] text-gray-400">
          <CornerDownLeft className="h-3 w-3" />
          Press Enter to search
        </div>
      )}
    </section>
  );
}

// ── Result group (Companies / Investors) ─────────────────────────────────────
function ResultGroup({
  icon: Icon, title, count, items,
}: {
  icon: React.ElementType; title: string; count: number; items: SemanticMatch[];
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#0F172A]/60" />
        <h3 className="text-sm font-bold text-[#0F172A]">{title}</h3>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">{count}</span>
      </div>
      <div className="space-y-2">
        {items.map((m) => <ResultRow key={`${m.entity_type}-${m.id}`} match={m} />)}
      </div>
    </div>
  );
}

// ── Single result row ────────────────────────────────────────────────────────
function ResultRow({ match }: { match: SemanticMatch }) {
  const isCompany = match.entity_type === "startup";
  const website = str(match.metadata.website);
  const pct = Math.round((match.similarity ?? 0) * 100);

  // Type-specific secondary line
  const chips: string[] = [];
  if (isCompany) {
    const industry = str(match.metadata.industry);
    const city = str(match.metadata.city);
    const country = str(match.metadata.country);
    if (industry) chips.push(industry);
    const loc = [city, country].filter(Boolean).join(", ");
    if (loc) chips.push(loc);
  } else {
    const ft = str(match.metadata.firm_type);
    if (ft) chips.push(FIRM_TYPE_LABEL[ft] ?? ft.toUpperCase());
    const hq = str(match.metadata.headquarters);
    if (hq) chips.push(hq);
    const fund = str(match.metadata.fund_size);
    if (fund) chips.push(fund);
  }

  return (
    <div className="group flex items-start gap-3 rounded-[16px] border border-gray-100 bg-white p-3.5 transition-all hover:border-gray-300 hover:shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
      <CompanyLogo name={match.name ?? "—"} website={website} size={40} rounded="rounded-[11px]" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="truncate text-sm font-bold text-[#0F172A]">{match.name ?? "—"}</h4>
          <span className="flex-none rounded-full bg-[#7C8967]/10 px-2 py-0.5 text-[10px] font-bold text-[#5C6A4C]">
            {pct}% match
          </span>
        </div>

        {match.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">{match.description}</p>
        )}

        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-gray-400">
            {chips.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i === 0 && (isCompany
                  ? <TrendingUp className="h-3 w-3" />
                  : <Landmark className="h-3 w-3" />)}
                {i > 0 && <MapPin className="h-3 w-3" />}
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Skeleton loader ──────────────────────────────────────────────────────────
function ResultsSkeleton() {
  return (
    <div className="space-y-6 text-left" aria-hidden>
      {[0, 1].map((g) => (
        <div key={g}>
          <div className="mb-2.5 h-4 w-28 animate-pulse rounded bg-gray-100" />
          <div className="space-y-2">
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex items-start gap-3 rounded-[16px] border border-gray-100 bg-white p-3.5">
                <div className="h-10 w-10 flex-none animate-pulse rounded-[11px] bg-gray-100" />
                <div className="min-w-0 flex-1 space-y-2 py-0.5">
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-gray-50" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-gray-50" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty / error state ──────────────────────────────────────────────────────
function StatePanel({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center rounded-[20px] border border-gray-100 bg-gray-50/60 px-6 py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white">
        {icon}
      </div>
      <p className="text-sm font-semibold text-[#0F172A]">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500">{body}</p>
    </div>
  );
}
