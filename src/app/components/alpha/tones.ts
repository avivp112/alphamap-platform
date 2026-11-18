/** Chip colours for the CRM stages, in the flat am- palette. */
export function crmStageTone(stage: string): string {
  switch (stage) {
    case "reviewing": return "bg-am-accent-soft text-am-accent";
    case "diligence": return "bg-[#F3E8FF] text-[#6B21A8]";
    case "term_sheet": return "bg-[#FFF4DD] text-am-warn";
    case "invested": return "bg-[#E7F6EF] text-am-pos";
    case "passed": return "bg-am-line text-am-ink-3";
    default: return "bg-am-canvas text-am-ink-2 border border-am-line";
  }
}
