import { useTranslation } from "react-i18next";

/** Translate a `myArea.v2.*` string. The English text is the fallback, so a missing key still reads. */
export function useAlphaT() {
  const { t } = useTranslation();
  return (key: string, fallback: string, vars?: Record<string, string | number>): string =>
    t(`myArea.v2.${key}`, { defaultValue: fallback, ...vars }) as string;
}
