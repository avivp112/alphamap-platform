// Phase 8: the "Generate Tear Sheet" PDF, built with @react-pdf/renderer.
//
// A tear sheet is traditionally a concise one-to-two-page summary, not a
// dump of every tab in TearsheetModal — this covers company header, key
// stats, the personalized Match Score, the AlphaMap Score breakdown, a
// funding-rounds table, and founders/leadership. Funding history that
// overflows just flows onto a second page — react-pdf paginates
// automatically, no manual page-break logic needed for a document this size.
//
// No live company logo image: the source chain CompanyLogo.tsx uses (Google
// favicons, then each company's own domain) has no guaranteed CORS/uptime
// story, and a failed image fetch inside @react-pdf/renderer fails the
// whole render — unacceptable for a feature whose whole point is an
// always-works, instant 1-click download. A plain initials tile (same
// navy as the rest of the document) is the deliberate trade-off.
import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import type { Startup, AlphaScore, MatchScoreResult, FundingRound } from "../../lib/supabase";
import { pdfStyles as s, COLORS, ROUND_HEX } from "../../lib/pdfStyles";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function fmtEmployees(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const PILLAR_LABELS: { key: keyof AlphaScore["pillars"] }[] = [
  { key: "investor_quality" }, { key: "team_quality" }, { key: "growth_velocity" },
  { key: "recency_activity" }, { key: "media_coverage" },
];

export function TearsheetPdfDocument({
  startup, alphaScore, matchResult,
}: {
  startup: Startup;
  alphaScore: AlphaScore | null;
  matchResult: MatchScoreResult | undefined;
}) {
  const location = [startup.city, startup.country].filter(Boolean).join(", ") || "—";
  const sectorName = startup.sector?.name ?? startup.industry ?? "—";
  const sortedRounds = [...(startup.funding_rounds ?? [])].sort(
    (a: FundingRound, b: FundingRound) => (a.announcement_date ?? "").localeCompare(b.announcement_date ?? ""),
  );
  const latestRound = sortedRounds[sortedRounds.length - 1] ?? null;
  const totalRaised = sortedRounds.reduce((sum, r) => sum + (r.amount_raised ?? 0), 0);

  const tierColor = alphaScore ? COLORS.tier[alphaScore.tier] : COLORS.gray400;
  const tierBg = alphaScore ? COLORS.tierBg[alphaScore.tier] : COLORS.gray50;
  const tierBorder = alphaScore ? COLORS.tierBorder[alphaScore.tier] : COLORS.border;

  return (
    <Document title={`AlphaMap Tear Sheet — ${startup.name}`}>
      <Page size="A4" style={s.page} wrap>
        {/* Header */}
        <View style={s.headerRow}>
          <View style={s.logoTile}>
            <Text style={s.logoTileText}>{initials(startup.name)}</Text>
          </View>
          <View>
            <Text style={s.companyName}>{startup.name}</Text>
            <View style={s.metaRow}>
              <Text style={s.metaText}>{sectorName}</Text>
              <Text style={s.metaText}>·</Text>
              <Text style={s.metaText}>{location}</Text>
              {startup.founded_year && (
                <>
                  <Text style={s.metaText}>·</Text>
                  <Text style={s.metaText}>Est. {startup.founded_year}</Text>
                </>
              )}
            </View>
          </View>
        </View>

        {/* Key stats */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statLabel}>Latest Valuation</Text>
            <Text style={s.statValue}>{fmtMoney(latestRound?.valuation)}</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statLabel}>Total Raised</Text>
            <Text style={s.statValue}>{fmtMoney(totalRaised)}</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statLabel}>Employees</Text>
            <Text style={s.statValue}>{fmtEmployees(startup.employee_count)}</Text>
          </View>
        </View>

        {/* Match Score */}
        <View style={[s.panel, { backgroundColor: COLORS.matchIndigoBg, borderColor: COLORS.matchIndigoBorder }]}>
          <View style={s.panelHeaderRow}>
            <Text style={s.panelTitle}>Your Match</Text>
          </View>
          {matchResult ? (
            <>
              <Text style={[s.panelBigNumber, { color: COLORS.matchIndigo }]}>{matchResult.match_pct}%</Text>
              <Text style={s.panelBody}>Personalized to the {matchResult.signal_count} companies you've saved</Text>
              <Text style={s.panelDisclosure}>
                Estimated from the similarity between this company's profile and the ones you've saved. Refreshes roughly every 30 minutes as you save more.
              </Text>
            </>
          ) : (
            <Text style={s.panelBody}>Still calibrating — save a few more companies to unlock your match score.</Text>
          )}
        </View>

        {/* AlphaMap Score */}
        <View style={[s.panel, { backgroundColor: tierBg, borderColor: tierBorder }]}>
          <View style={s.panelHeaderRow}>
            <Text style={s.panelTitle}>AlphaMap Score</Text>
          </View>
          {alphaScore && !alphaScore.error && alphaScore.pillars ? (
            <>
              <Text style={[s.panelBigNumber, { color: tierColor }]}>
                {alphaScore.score.toFixed(0)} <Text style={{ fontSize: 12 }}>· Tier {alphaScore.tier}</Text>
              </Text>
              <View style={{ marginTop: 6 }}>
                {PILLAR_LABELS.map(({ key }) => {
                  const pillar = alphaScore.pillars[key];
                  if (!pillar) return null;
                  const pct = pillar.valid && pillar.score != null ? pillar.score : 0;
                  return (
                    <View key={key} style={s.pillarRow}>
                      <View style={s.pillarLabelRow}>
                        <Text style={s.pillarLabel}>{pillar.label}</Text>
                        <Text style={s.pillarScore}>
                          {pillar.valid && pillar.score != null ? pillar.score.toFixed(0) : "—"} / {pillar.weight}%
                        </Text>
                      </View>
                      <View style={s.pillarBarTrack}>
                        <View style={[s.pillarBarFill, { width: `${pct}%`, backgroundColor: tierColor }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
              <Text style={s.panelDisclosure}>Final score = base × (1 + macro adjustment), capped 1-100.</Text>
            </>
          ) : (
            <Text style={s.panelBody}>Score pending data enrichment.</Text>
          )}
        </View>

        {/* Funding rounds */}
        {sortedRounds.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <Text style={s.sectionLabel}>Funding Timeline</Text>
            <View style={s.table}>
              <View style={s.tableHeaderRow}>
                <Text style={s.tableCellHeader}>Round</Text>
                <Text style={s.tableCellHeader}>Date</Text>
                <Text style={s.tableCellHeader}>Amount Raised</Text>
                <Text style={s.tableCellHeader}>Valuation</Text>
              </View>
              {sortedRounds.map((r, i) => {
                const isLast = i === sortedRounds.length - 1;
                const roundColor = ROUND_HEX[r.round_type ?? "Other"] ?? ROUND_HEX["Other"];
                return (
                  <View key={r.id} style={isLast ? s.tableRowLast : s.tableRow}>
                    <View style={{ flex: 1, padding: 6 }}>
                      <Text style={[s.roundBadge, { color: roundColor, backgroundColor: `${roundColor}18` }]}>
                        {r.round_type ?? "Other"}
                      </Text>
                    </View>
                    <Text style={s.tableCell}>{fmtDate(r.announcement_date)}</Text>
                    <Text style={s.tableCell}>{fmtMoney(r.amount_raised)}</Text>
                    <Text style={s.tableCell}>
                      {fmtMoney(r.valuation)}{r.is_valuation_estimated ? " (est.)" : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Founders & leadership */}
        {((startup.founders?.length ?? 0) > 0 || (startup.leadership?.length ?? 0) > 0) && (
          <View>
            <Text style={s.sectionLabel}>Founders & Leadership</Text>
            {(startup.founders ?? []).map((f, i) => (
              <View key={`f-${i}`} style={s.founderRow}>
                <Text style={s.founderName}>{f.name}</Text>
                <Text style={s.founderRole}>Founder</Text>
              </View>
            ))}
            {(startup.leadership ?? []).map((l, i) => (
              <View key={`l-${i}`} style={s.founderRow}>
                <Text style={s.founderName}>{l.name}</Text>
                <Text style={s.founderRole}>{l.role}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>Generated by AlphaMap on {fmtDate(new Date().toISOString())}</Text>
          <Text>Match Score and AlphaMap Score are estimates, not investment advice.</Text>
        </View>
      </Page>
    </Document>
  );
}
