import { useTranslation } from "react-i18next";

/** Translate a `deals.v2.*` string. The English text is the fallback, so a missing key still reads. */
export function useDealsT() {
  const { t } = useTranslation();
  return (key: string, fallback: string, vars?: Record<string, string | number>): string =>
    t(`deals.v2.${key}`, { defaultValue: fallback, ...vars }) as string;
}
