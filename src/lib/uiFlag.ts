// Switch for the redesigned Private Market page. Off by default, so merging the
// new UI changes nothing for anyone until it is turned on:
//   /startups?ui=2   turn on (remembered in this browser)
//   /startups?ui=1   turn off again
// Remove this file, and the `uiV2` branches in Startups.tsx, when the new UI becomes the only one.

export const UI_V2_KEY = "am_ui";

export function resolveUiV2(param: string | null): boolean {
  try {
    if (param === "2") { localStorage.setItem(UI_V2_KEY, "2"); return true; }
    if (param === "1") { localStorage.removeItem(UI_V2_KEY); return false; }
    return localStorage.getItem(UI_V2_KEY) === "2";
  } catch {
    // Storage blocked (private mode, embedded view): honour the URL for this visit only.
    return param === "2";
  }
}
