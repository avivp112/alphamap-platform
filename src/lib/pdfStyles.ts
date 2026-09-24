// Phase 8: shared design tokens for the Tear Sheet PDF (@react-pdf/renderer).
//
// react-pdf builds its own PDF primitives (View/Text/Svg) — it has no idea
// what Tailwind is, so the tear sheet is necessarily a second render path,
// not a literal reuse of TearsheetModal's JSX. To keep it reading as the
// same product rather than a generic export, every color below is copied
// verbatim from where it's already hard-coded in src/app/pages/Startups.tsx
// (ROUND_HEX, TIER_CONFIG) rather than invented fresh for print.
//
// Font: Helvetica (react-pdf's built-in standard font, always available,
// zero network dependency) rather than embedding the app's actual Inter
// webfont. Registering a custom font in react-pdf needs a fetchable
// TTF/OTF URL at render time — an extra network dependency this "instant,
// 1-click" feature deliberately avoids, since a failed font fetch would
// break PDF generation entirely. Helvetica is the standard professional
// choice for this kind of document anyway.
import { StyleSheet } from "@react-pdf/renderer";

export const COLORS = {
  navy: "#0F172A",
  navyMuted: "#64748B",
  amber: "#F59E0B",
  gray400: "#9CA3AF",
  gray500: "#6B7280",
  gray100: "#F3F4F6",
  gray50: "#F9FAFB",
  border: "#E5E7EB",

  tier: { A: "#059669", B: "#2563EB", C: "#E11D48" } as Record<"A" | "B" | "C", string>,
  tierBg: { A: "#ECFDF5", B: "#EFF6FF", C: "#FFF1F2" } as Record<"A" | "B" | "C", string>,
  tierBorder: { A: "#A7F3D0", B: "#BFDBFE", C: "#FECDD3" } as Record<"A" | "B" | "C", string>,

  // Same indigo family as the Match Score badge in Startups.tsx — never the
  // AlphaMap Score's emerald/blue/rose, so the two metrics stay visually
  // distinct on the page the same way they do on screen.
  matchIndigo: "#4338CA",
  matchIndigoBg: "#EEF2FF",
  matchIndigoBorder: "#E0E7FF",
};

// Copied verbatim from ROUND_HEX in src/app/pages/Startups.tsx.
export const ROUND_HEX: Record<string, string> = {
  "Pre-Seed": "#7C3AED", "Seed": "#2563EB", "Series A": "#059669",
  "Series B": "#D97706", "Series C": "#EA580C", "Series D": "#C2410C",
  "Series E+": "#DC2626", "Growth": "#4338CA", "Bridge": "#0284C7",
  "Convertible Note": "#0891B2", "Bootstrapped": "#0D9488",
  "Grant": "#65A30D", "Acquired": "#6B7280",
  "PE Buyout": "#475569", "Secondary": "#78716C", "Debt": "#71717A",
  "Other": "#9CA3AF",
};

export const pdfStyles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: COLORS.navy,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  logoTile: {
    width: 40, height: 40, borderRadius: 6,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.navy,
  },
  logoTileText: { color: "#FFFFFF", fontSize: 14, fontFamily: "Helvetica-Bold" },
  companyName: { fontSize: 18, fontFamily: "Helvetica-Bold", color: COLORS.navy },
  metaRow: { flexDirection: "row", gap: 10, marginTop: 3 },
  metaText: { fontSize: 9, color: COLORS.navyMuted },

  sectionLabel: {
    fontSize: 8, fontFamily: "Helvetica-Bold", color: COLORS.gray400,
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
  },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: COLORS.gray50, borderRadius: 6,
    borderWidth: 1, borderColor: COLORS.border, padding: 10,
  },
  statLabel: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: COLORS.gray400, textTransform: "uppercase", marginBottom: 3 },
  statValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: COLORS.navy },

  panel: { borderRadius: 6, borderWidth: 1, padding: 12, marginBottom: 14 },
  panelHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  panelTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: COLORS.gray500, textTransform: "uppercase", letterSpacing: 0.6 },
  panelBigNumber: { fontSize: 26, fontFamily: "Helvetica-Bold" },
  panelBody: { fontSize: 9, color: COLORS.gray500, lineHeight: 1.4 },
  panelDisclosure: { fontSize: 7.5, color: COLORS.gray400, marginTop: 6, lineHeight: 1.4 },

  pillarRow: { marginBottom: 5 },
  pillarLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  pillarLabel: { fontSize: 8.5, color: COLORS.gray500 },
  pillarScore: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: COLORS.navy },
  pillarBarTrack: { height: 4, borderRadius: 2, backgroundColor: "#FFFFFF" },
  pillarBarFill: { height: 4, borderRadius: 2 },

  table: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, overflow: "hidden" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: COLORS.gray50, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tableRowLast: { flexDirection: "row" },
  tableCellHeader: { flex: 1, padding: 6, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: COLORS.gray400, textTransform: "uppercase" },
  tableCell: { flex: 1, padding: 6, fontSize: 8.5, color: COLORS.navy },

  founderRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  founderName: { fontSize: 9, fontFamily: "Helvetica-Bold", color: COLORS.navy },
  founderRole: { fontSize: 8.5, color: COLORS.gray500 },

  roundBadge: { fontSize: 7.5, fontFamily: "Helvetica-Bold", paddingVertical: 2, paddingHorizontal: 6, borderRadius: 10, alignSelf: "flex-start" },

  footer: {
    position: "absolute", bottom: 24, left: 36, right: 36,
    flexDirection: "row", justifyContent: "space-between",
    fontSize: 7.5, color: COLORS.gray400,
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 6,
  },
});
