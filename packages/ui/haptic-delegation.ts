// Global MUI haptic delegation — call installHaptics() ONCE at app startup and
// every MUI control buzzes with the right feel, with zero per-call-site wiring:
//
//   • any .MuiButtonBase-root (Button, IconButton, MenuItem, ListItemButton, Tab,
//     Chip, ToggleButton, AccordionSummary, Select trigger, …) → a light impact on
//     press (medium for a destructive/error button, or one tagged data-haptic).
//   • any .MuiSwitch / .MuiCheckbox / .MuiRadio flip → a selection tick.
//   • any popup (Dialog, Menu, Popover, Drawer, Select dropdown — all mount a
//     .MuiModal-root portal) → a soft impact on OPEN; dismiss buzzes AT THE GESTURE
//     (the option/button press, or a backdrop tap), not on the delayed removal.
//
// Why delegation instead of wrapping components: it covers EVERY MUI surface in the
// app (including ones added later) from one listener set, and it composes with
// explicit haptic() calls for keyboard/semantic actions — the haptics primitive's
// coalesce window collapses a delegated press + an explicit call for the same
// gesture into a single tap, so nothing double-buzzes.
//
// iOS-native in spirit: feedback on touch-DOWN for buttons (immediate), a
// selection tick for toggles, a soft present/dismiss for sheets.

import { haptic, selectionHaptic } from "./haptics.ts";

export interface HapticDelegationOptions {
  /** Buzz on MuiButtonBase press. Default true. */
  readonly buttons?: boolean;
  /** Buzz on Switch/Checkbox/Radio flip. Default true. */
  readonly toggles?: boolean;
  /** Buzz on popup (Modal portal) open/close. Default true. */
  readonly overlays?: boolean;
}

const OVERLAY_SELECTOR = ".MuiModal-root, .MuiPopover-root, .MuiDialog-root, .MuiDrawer-root";
const TOGGLE_SELECTOR = ".MuiSwitch-root, .MuiCheckbox-root, .MuiRadio-root";
// Pressable surfaces. MuiButtonBase covers Button/IconButton/MenuItem/ListItemButton/
// Tab/Chip/ToggleButton, but a MUI Select trigger is a plain role=combobox div (NOT
// a ButtonBase), so add it explicitly — otherwise dropdowns feel dead on tap.
const PRESS_SELECTOR = '.MuiButtonBase-root, .MuiSelect-select, [role="combobox"]';
// A button-triggered popup opens within ~this long of the press; inside the window
// the press already buzzed, so the open is suppressed (no double). A programmatic
// open (no recent press) still buzzes.
const PRESS_TO_OPEN_MS = 250;

function now(): number {
  return globalThis.performance?.now?.() ?? 0;
}

let lastPressAt = -Infinity;

function onPointerDownHaptic(e: Event): void {
  const target = e.target as Element | null;
  // Tap-outside dismiss: a press on a popup backdrop closes it. Fire the dismiss
  // tap NOW, at the gesture — not when the portal is finally removed (that lands
  // AFTER the close animation, which feels like a delayed buzz). Select options /
  // Dialog buttons are MuiButtonBase, so THEY already buzz at press; this covers
  // the click-outside path that has no button of its own.
  if (target?.closest?.(".MuiBackdrop-root")) {
    haptic("light");
    return;
  }
  const btn = target?.closest?.(PRESS_SELECTOR) ?? null;
  if (btn === null) {
    return;
  }
  if (btn.classList.contains("Mui-disabled") || btn.hasAttribute("disabled")) {
    return;
  }
  lastPressAt = now();
  // Destructive / explicitly-tagged controls get a firmer tap.
  const tag = btn instanceof HTMLElement ? btn.dataset["haptic"] : undefined;
  const strong = tag === "medium" ||
    btn.classList.contains("MuiButton-colorError") ||
    btn.classList.contains("MuiIconButton-colorError");
  haptic(strong ? "medium" : "light");
}

function onChangeHaptic(e: Event): void {
  const target = e.target as Element | null;
  if (target?.closest?.(TOGGLE_SELECTOR)) {
    selectionHaptic();
  }
}

function anyOverlay(nodes: NodeList): boolean {
  for (const n of nodes) {
    if (n instanceof Element && n.matches(OVERLAY_SELECTOR)) {
      return true;
    }
  }
  return false;
}

function onOverlayMutations(records: MutationRecord[]): void {
  for (const r of records) {
    // OPEN only: a soft present, UNLESS a button just opened it (the press already
    // buzzed — suppress to avoid a double). The portal is ADDED instantly on open,
    // so this is in sync with the gesture. CLOSE is deliberately NOT handled here:
    // the portal is REMOVED only after the close animation, which feels like a
    // delayed buzz — dismiss is signalled at the gesture instead (the option/button
    // press, or the backdrop pointerdown above).
    if (anyOverlay(r.addedNodes) && now() - lastPressAt > PRESS_TO_OPEN_MS) {
      haptic("soft");
    }
  }
}

/** Install the global delegation. Returns a cleanup fn (remove all listeners). */
export function installHaptics(opts: HapticDelegationOptions = {}): () => void {
  const { buttons = true, toggles = true, overlays = true } = opts;
  const doc = globalThis.document as Document | undefined;
  if (doc?.body === undefined || doc.body === null) {
    return () => {};
  }
  const cleanups: (() => void)[] = [];

  if (buttons) {
    doc.addEventListener("pointerdown", onPointerDownHaptic, { capture: true, passive: true });
    cleanups.push(() => doc.removeEventListener("pointerdown", onPointerDownHaptic, { capture: true }));
  }

  if (toggles) {
    doc.addEventListener("change", onChangeHaptic, { capture: true });
    cleanups.push(() => doc.removeEventListener("change", onChangeHaptic, { capture: true }));
  }

  if (overlays && typeof MutationObserver !== "undefined") {
    const obs = new MutationObserver(onOverlayMutations);
    obs.observe(doc.body, { childList: true });
    cleanups.push(() => obs.disconnect());
  }

  return () => {
    for (const c of cleanups) {
      c();
    }
  };
}
