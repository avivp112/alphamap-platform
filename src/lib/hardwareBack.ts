import { useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// The Android hardware/gesture back button is wired (see main.tsx) to a single
// global Capacitor `backButton` listener, but the app has many overlays —
// the company tearsheet, its pass-reason and lookalikes sub-panels, TopNav's
// mobile menu and dropdowns — that open via local component state rather than
// a route change. Without this, pressing back while one of those is open
// either falls through to `window.history.back()` (navigating the page
// underneath the still-open overlay) or, if there's no router history left,
// exits the app entirely — which is exactly the "back completely exits the
// app" bug this file exists to fix.
//
// Every open overlay pushes its own close function here; the global listener
// always tries the topmost one first, and only falls through to route-level
// back / app-exit once the stack is empty. A plain array (not a more elaborate
// state manager) is enough — overlays nest at most two or three deep, and
// last-in-first-out is exactly the semantics a stack of open panels wants.
// ─────────────────────────────────────────────────────────────────────────────

type BackHandler = () => void;

const stack: BackHandler[] = [];

/**
 * Registers `handler` to run on the next hardware back action, ahead of
 * normal in-app navigation. Returns an unregister function — always call it
 * on cleanup (see `useBackClose` below), so a closed overlay never leaves a
 * stale handler behind to eat a later back press meant for something else.
 */
export function pushBackHandler(handler: BackHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i !== -1) stack.splice(i, 1);
  };
}

/**
 * Called by the platform-level listener in main.tsx. Runs the topmost open
 * overlay's close handler and returns true if there was one; returns false
 * (nothing handled) so the caller can fall through to router history / exit.
 */
export function consumeBackHandler(): boolean {
  const handler = stack[stack.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

/**
 * Registers `onClose` as the hardware-back handler for as long as `active`
 * is true. Use this in any modal/drawer/dropdown so the Android back button
 * closes it — returning the user to whatever was underneath — instead of
 * navigating the page underneath it or exiting the app.
 */
export function useBackClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(onClose);
  }, [active, onClose]);
}
