import { loadBaseline as load } from "../../lib/enrichment/regressionGate.ts";
import { isCoreField } from "../../lib/enrichment/tiers.ts";
export const loadBaseline = load;
export const isCoreFieldForBaseline = (v: { field: string }) => isCoreField(v.field) && v.field !== "(nothing)";
