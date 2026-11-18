import { useTranslation } from "react-i18next";
import type { MoneyRange, StageChoice } from "../../../lib/startupFilters";

/** Everything the Private Market filters hold, as the new FilterBar / FilterDrawer see it. */
export interface FilterState {
  parentSector: string;
  subSector: string;
  subSectorTag: string;
  country: string;
  city: string;
  israelRelated: boolean;
  stageSteps: StageChoice[];
  headcountStep: string;
  momentum: boolean;
  density: "all" | "crowded" | "blue-ocean";
  fundedWithinDays: number | null;
  valuation: MoneyRange;
  raised: MoneyRange;
  updatedWithinDays: number | null;
}

export interface FilterActions {
  setSector: (parent: string, sub: string) => void;
  setCountry: (v: string) => void;
  setStageSteps: (v: StageChoice[]) => void;
  setHeadcountStep: (v: string) => void;
  setMomentum: (v: boolean) => void;
  setDensity: (v: "all" | "crowded" | "blue-ocean") => void;
  setValuation: (v: MoneyRange) => void;
  setRaised: (v: MoneyRange) => void;
  setUpdatedWithinDays: (v: number | null) => void;
  /** Remove one filter by its chip id. */
  clearOne: (id: string) => void;
  clearAll: () => void;
}

export interface HeadcountOption { value: string; label: string }

/** Translate a `startups.v2.*` string. The English text is the fallback, so a missing key still reads. */
export function useV2T() {
  const { t } = useTranslation();
  return (key: string, fallback: string, vars?: Record<string, string | number>): string =>
    t(`startups.v2.${key}`, { defaultValue: fallback, ...vars }) as string;
}
