// DetentSheet open-registry — a module-level count of currently-open sheets, so
// OTHER fixed-position chrome (e.g. a floating action puck) can recede while a
// sheet is up.
//
// Load-bearing because DetentSheet renders INLINE (no portal — see its header):
// its z-index is trapped in whatever ancestor stacking context it sits in, so a
// root-level `position: fixed` element can paint OVER it. Rather than portal
// (which breaks the iframe-host case the inline design exists for), let those
// elements subscribe and hide themselves while a sheet is open. This is purely a
// JS counter + listeners — ZERO document mutation — so it preserves the
// no-side-effects property the inline design depends on.

import { useEffect, useState } from "react";

let openCount = 0;
const listeners = new Set<(open: boolean) => void>();

function notify(): void {
  const anyOpen = openCount > 0;
  listeners.forEach((l) => l(anyOpen));
}

/** Called by DetentSheet while it is open; returns the matching "closed"
 *  decrement to run on cleanup. */
export function markDetentSheetOpen(): () => void {
  openCount += 1;
  notify();
  return () => {
    openCount -= 1;
    notify();
  };
}

/** Subscribe to "is any DetentSheet open?". Fires immediately with the current
 *  value, then on every change. Returns an unsubscribe. */
export function subscribeAnyDetentSheetOpen(
  onChange: (open: boolean) => void,
): () => void {
  listeners.add(onChange);
  onChange(openCount > 0);
  return () => {
    listeners.delete(onChange);
  };
}

/** React hook: true while at least one DetentSheet is open anywhere. */
export function useAnyDetentSheetOpen(): boolean {
  const [open, setOpen] = useState(openCount > 0);
  useEffect(() => subscribeAnyDetentSheetOpen(setOpen), []);
  return open;
}
