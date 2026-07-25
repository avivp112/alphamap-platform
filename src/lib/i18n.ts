import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../../locales/en.json";
import es from "../../locales/es.json";
import zh from "../../locales/zh.json";
import ja from "../../locales/ja.json";

export const STORAGE_KEY = "alphamap.language";

export interface LanguageOption {
  code: SupportedLanguage;
  /** Native-script name, as a speaker of that language would write it. */
  nativeName: string;
  flag: string;
  /** BCP-47 tag used for Intl number/date formatting. */
  locale: string;
}

export type SupportedLanguage = "en" | "es" | "zh" | "ja";

export const LANGUAGES: LanguageOption[] = [
  { code: "en", nativeName: "English",  flag: "🇺🇸", locale: "en-US" },
  { code: "es", nativeName: "Español",  flag: "🇪🇸", locale: "es-ES" },
  { code: "zh", nativeName: "中文",      flag: "🇨🇳", locale: "zh-CN" },
  { code: "ja", nativeName: "日本語",    flag: "🇯🇵", locale: "ja-JP" },
];

const SUPPORTED = LANGUAGES.map((l) => l.code);

function isSupported(value: string | null | undefined): value is SupportedLanguage {
  return !!value && (SUPPORTED as string[]).includes(value);
}

/**
 * Resolve the startup language: an explicit previous choice wins, otherwise
 * fall back to the browser's preference, otherwise English. Reading
 * localStorage is wrapped because it throws in private-mode Safari and when
 * the page is embedded in a sandboxed iframe.
 */
function detectLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSupported(stored)) return stored;
  } catch {
    /* storage unavailable — fall through to browser preference */
  }

  for (const tag of navigator.languages ?? [navigator.language]) {
    // Match on the primary subtag so "es-419", "zh-Hans-CN" and "ja-JP" all
    // resolve to the dictionary we actually ship.
    const primary = tag?.split("-")[0]?.toLowerCase();
    if (isSupported(primary)) return primary;
  }
  return "en";
}

export function persistLanguage(code: SupportedLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* non-fatal: the choice simply won't survive a reload */
  }
}

export function localeFor(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.locale ?? "en-US";
}

const initial = detectLanguage();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    zh: { translation: zh },
    ja: { translation: ja },
  },
  lng: initial,
  fallbackLng: "en",
  supportedLngs: SUPPORTED,
  // Keys are dotted paths ("nav.home"); the default nsSeparator (":") would
  // otherwise swallow any colon that appears inside a translated string.
  nsSeparator: false,
  interpolation: {
    // React escapes rendered output already.
    escapeValue: false,
  },
});

// Keep <html lang> in sync so screen readers, spellcheck and CJK font
// fallback pick the right language from the very first paint.
function applyDocumentLanguage(code: string) {
  if (typeof document !== "undefined") document.documentElement.lang = code;
}
applyDocumentLanguage(initial);
i18n.on("languageChanged", applyDocumentLanguage);

export default i18n;
