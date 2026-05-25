import React, { useState, useEffect, useRef } from "react";
import { TopNav } from "../components/TopNav";
import { Sidebar } from "../components/Sidebar";
import {
  Plus, Globe, Linkedin, TrendingUp, TrendingDown, Minus,
  Loader2, Search, X, MapPin, Calendar, Users, DollarSign,
  Rocket, AlertCircle, CheckCircle2, ChevronDown, ChevronUp,
} from "lucide-react";
import { fetchStartups, ingestStartup, type Startup, type StartupStage } from "../../lib/supabase";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(usd: number | null): string {
  if (!usd) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd}`;
}

function formatEmployees(n: number | null): string {
  if (!n) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const STAGE_STYLE: Record<StartupStage, string> = {
  "Pre-Seed": "bg-purple-50 text-purple-700 border border-purple-100",
  "Seed": "bg-blue-50 text-blue-700 border border-blue-100",
  "Series A": "bg-emerald-50 text-emerald-700 border border-emerald-100",
  "Series B": "bg-amber-50 text-amber-700 border border-amber-100",
  "Series C+": "bg-orange-50 text-orange-700 border border-orange-100",
  "Growth": "bg-indigo-50 text-indigo-700 border border-indigo-100",
  "Bootstrapped": "bg-teal-50 text-teal-700 border border-teal-100",
  "Acquired": "bg-gray-100 text-gray-600 border border-gray-200",
};

const ALL_STAGES: StartupStage[] = [
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C+",
  "Growth", "Bootstrapped", "Acquired",
];

const PROGRESS_MESSAGES = [
  "Searching the web for funding data…",
  "Analyzing founding team & leadership…",
  "Processing market intelligence…",
  "Scanning job boards for hiring signals…",
  "Validating entry conditions…",
  "Saving to AlphaMap…",
];

// ─── Startup Card ────────────────────────────────────────────────────────────

function StartupCard({ startup }: { startup: Startup }) {
  const [expanded, setExpanded] = useState(false);

  const confidence = startup.data_confidence ?? 0;
  const confidenceColor =
    confidence >= 0.7 ? "bg-emerald-400" :
    confidence >= 0.4 ? "bg-amber-400" : "bg-red-400";

  const HiringIcon =
    startup.hiring_trend === "Growing" ? TrendingUp :
    startup.hiring_trend === "Shrinking" ? TrendingDown : Minus;

  const hiringColor =
    startup.hiring_trend === "Growing" ? "text-emerald-600" :
    startup.hiring_trend === "Shrinking" ? "text-red-500" : "text-gray-400";

  return (
    <div className="bg-white rounded-[20px] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all duration-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-4 flex-1">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-[#0F172A] truncate leading-tight">
              {startup.name}
            </h3>
            {startup.industry && (
              <span className="inline-block mt-1 text-xs font-medium text-gray-400 uppercase tracking-wide">
                {startup.industry}
              </span>
            )}
          </div>
          {startup.stage && (
            <span className={`flex-none text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${STAGE_STYLE[startup.stage]}`}>
              {startup.stage}
            </span>
          )}
        </div>

        {startup.tagline && (
          <p className="text-sm text-gray-500 leading-relaxed line-clamp-2 mb-4">
            {startup.tagline}
          </p>
        )}

        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-[#F8FAFC] rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign className="w-3.5 h-3.5 text-[#F59E0B]" />
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Valuation</span>
            </div>
            <span className="text-sm font-bold text-[#0F172A]">
              {formatCurrency(startup.valuation_usd)}
            </span>
          </div>
          <div className="bg-[#F8FAFC] rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign className="w-3.5 h-3.5 text-[#F59E0B]" />
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Raised</span>
            </div>
            <span className="text-sm font-bold text-[#0F172A]">
              {formatCurrency(startup.total_raised_usd)}
            </span>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-400 mb-4">
          {startup.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {startup.location}
            </span>
          )}
          {startup.founding_year && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {startup.founding_year}
            </span>
          )}
          {startup.employee_count && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" /> {formatEmployees(startup.employee_count)} emp.
            </span>
          )}
        </div>

        {/* Hiring trend */}
        {startup.hiring_trend && startup.hiring_trend !== "Unknown" && (
          <div className={`flex items-center gap-1.5 text-xs font-medium mb-4 ${hiringColor}`}>
            <HiringIcon className="w-3.5 h-3.5" />
            Hiring {startup.hiring_trend}
          </div>
        )}

        {/* Founders (expandable) */}
        {startup.founders && startup.founders.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-[#0F172A] transition-colors mb-2"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {startup.founders.length} founder{startup.founders.length > 1 ? "s" : ""}
            </button>
            {expanded && (
              <div className="flex flex-col gap-1.5">
                {startup.founders.slice(0, 4).map((f, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-[#0F172A]">{f.name}</span>
                      {f.title && <span className="text-xs text-gray-400 ml-1.5">{f.title}</span>}
                    </div>
                    {f.linkedin && (
                      <a
                        href={f.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-300 hover:text-blue-500 transition-colors"
                      >
                        <Linkedin className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {startup.website && (
            <a
              href={startup.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#0F172A] transition-colors font-medium"
            >
              <Globe className="w-3.5 h-3.5" /> Website
            </a>
          )}
          {startup.linkedin_url && (
            <a
              href={startup.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors font-medium"
            >
              <Linkedin className="w-3.5 h-3.5" /> LinkedIn
            </a>
          )}
        </div>
        {startup.data_confidence != null && (
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${confidenceColor}`} />
            <span className="text-[10px] text-gray-400 font-medium">
              {Math.round(confidence * 100)}% verified
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Add Dialog ──────────────────────────────────────────────────────────────

function AddStartupDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (s: Startup) => void;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [progressIdx, setProgressIdx] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setStatus("idle");
      setErrorMsg("");
      setProgressIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (status === "loading") {
      progressTimer.current = setInterval(() => {
        setProgressIdx((i) => Math.min(i + 1, PROGRESS_MESSAGES.length - 1));
      }, 3500);
    } else {
      if (progressTimer.current) clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, [status]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setStatus("loading");
    setProgressIdx(0);
    setErrorMsg("");
    try {
      const startup = await ingestStartup(name.trim());
      setStatus("success");
      setTimeout(() => {
        onSuccess(startup);
        onClose();
      }, 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={status !== "loading" ? onClose : undefined} />
      <div className="relative bg-white rounded-[24px] shadow-[0_24px_60px_rgba(0,0,0,0.12)] w-full max-w-md p-8 border border-gray-100">
        <button
          onClick={onClose}
          disabled={status === "loading"}
          className="absolute top-5 right-5 text-gray-300 hover:text-gray-600 transition-colors disabled:opacity-30"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center">
            <Rocket className="w-5 h-5 text-[#F59E0B]" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Add a Startup</h2>
            <p className="text-xs text-gray-400">The agent researches and validates it automatically</p>
          </div>
        </div>

        {status === "success" ? (
          <div className="flex flex-col items-center py-4 gap-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="text-sm font-semibold text-[#0F172A]">Added successfully!</p>
          </div>
        ) : status === "loading" ? (
          <div className="flex flex-col items-center py-6 gap-4 text-center">
            <Loader2 className="w-8 h-8 text-[#F59E0B] animate-spin" />
            <div>
              <p className="text-sm font-semibold text-[#0F172A] mb-1">Researching "{name}"</p>
              <p className="text-xs text-gray-400">{PROGRESS_MESSAGES[progressIdx]}</p>
            </div>
            <div className="flex gap-1 mt-2">
              {PROGRESS_MESSAGES.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 w-6 rounded-full transition-all duration-500 ${
                    i <= progressIdx ? "bg-[#F59E0B]" : "bg-gray-100"
                  }`}
                />
              ))}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {status === "error" && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 mb-4 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 flex-none mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Company name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Stripe, Figma, Notion…"
              className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm text-[#0F172A] placeholder-gray-300 focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/10 transition-all"
            />
            <p className="text-[11px] text-gray-400 mt-2 mb-5">
              The agent will search the web, extract funding data, validate the entry, and save it — takes ~15 seconds.
            </p>
            <button
              type="submit"
              disabled={!name.trim()}
              className="w-full rounded-[12px] bg-[#0F172A] hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-300 text-white font-semibold text-sm py-3 transition-all duration-200"
            >
              Research & Add
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function Startups() {
  const [startups, setStartups] = useState<Startup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<StartupStage | "All">("All");

  useEffect(() => {
    fetchStartups()
      .then(setStartups)
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function handleAdded(startup: Startup) {
    setStartups((prev) => [startup, ...prev]);
  }

  const filtered = startups.filter((s) => {
    const matchSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.industry ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.tagline ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStage = stageFilter === "All" || s.stage === stageFilter;
    return matchSearch && matchStage;
  });

  const stageCounts = ALL_STAGES.map((stage) => ({
    stage,
    count: startups.filter((s) => s.stage === stage).length,
  })).filter((s) => s.count > 0);

  return (
    <div className="flex min-h-screen flex-col bg-[#F3F4F6] font-sans antialiased text-[#0F172A]">
      <TopNav />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 lg:ml-64 w-full max-w-full overflow-x-hidden">
          <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">

            {/* Page Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
                  Startups
                </h1>
                <p className="mt-1 sm:mt-2 text-sm font-medium text-gray-500">
                  AI-researched private companies — added one by one, verified by the agent.
                </p>
              </div>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 rounded-[16px] bg-[#F59E0B] px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_14px_rgba(245,158,11,0.3)] hover:bg-amber-600 hover:shadow-[0_4px_20px_rgba(245,158,11,0.4)] transition-all"
              >
                <Plus className="w-4 h-4" />
                Add Startup
              </button>
            </div>

            {/* Stage summary chips */}
            {stageCounts.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                <button
                  onClick={() => setStageFilter("All")}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    stageFilter === "All"
                      ? "bg-[#0F172A] text-white border-[#0F172A]"
                      : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  All ({startups.length})
                </button>
                {stageCounts.map(({ stage, count }) => (
                  <button
                    key={stage}
                    onClick={() => setStageFilter(stageFilter === stage ? "All" : stage)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                      stageFilter === stage
                        ? "bg-[#0F172A] text-white border-[#0F172A]"
                        : `${STAGE_STYLE[stage]} hover:opacity-80`
                    }`}
                  >
                    {stage} ({count})
                  </button>
                ))}
              </div>
            )}

            {/* Search */}
            {startups.length > 0 && (
              <div className="relative mb-8 max-w-sm">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, industry…"
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-[12px] focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/10 transition-all"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {/* States */}
            {loading ? (
              <div className="flex items-center justify-center py-32">
                <Loader2 className="w-6 h-6 text-[#F59E0B] animate-spin" />
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center py-24 gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm font-semibold text-[#0F172A]">Failed to load startups</p>
                <p className="text-xs text-gray-400 max-w-xs">{loadError}</p>
              </div>
            ) : startups.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-32 text-center">
                <div className="w-16 h-16 rounded-3xl bg-amber-50 flex items-center justify-center mb-6">
                  <Rocket className="w-7 h-7 text-[#F59E0B]" />
                </div>
                <h2 className="text-xl font-bold text-[#0F172A] mb-3">No startups yet</h2>
                <p className="text-sm text-gray-400 max-w-sm leading-relaxed mb-8">
                  Add your first startup — the AI agent will research it online, validate the data, and save it here.
                </p>
                <button
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-2 rounded-[16px] bg-[#F59E0B] px-6 py-3 text-sm font-bold text-white shadow-[0_4px_14px_rgba(245,158,11,0.3)] hover:bg-amber-600 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Add First Startup
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center py-20 gap-3 text-center">
                <p className="text-sm font-semibold text-gray-400">No results for "{search}"</p>
                <button onClick={() => { setSearch(""); setStageFilter("All"); }} className="text-xs text-[#F59E0B] font-medium hover:underline">
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {filtered.map((s) => (
                  <StartupCard key={s.id} startup={s} />
                ))}
              </div>
            )}

          </div>
        </main>
      </div>

      <AddStartupDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={handleAdded}
      />
    </div>
  );
}
