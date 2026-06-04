// DetentSheet — a content-sizing momentum bottom sheet for mobile.
//
// Initial height fits the CONTENT, not the viewport: the sheet is as tall as
// its rows (capped at MAX_FRACTION so a scrim strip always shows) and opens
// fully visible. A short sheet (a confirm, a two-row settings panel) is short —
// no wasted empty space, no janky full-page feel. Only when the content is tall
// enough to be worth a second stop (> PEEK_ENABLE_FRACTION of the viewport) does
// the sheet gain the medium "peek" detent below full; below that it has a single
// content-sized level (flick down to dismiss). "Two levels by default; one level
// when the content is small."
//
// Self-contained overlay: it renders a fixed scrim + sheet INSIDE the caller's
// own tree and touches nothing else. Deliberately NOT a MUI Modal — a Modal
// mounts into document.body, locks body scroll, and sets aria-hidden on #root.
// When the app is embedded in a cross-origin iframe host (a portal), #root holds
// that hosted iframe; on iOS those document mutations perturb the visual
// viewport, which the host mirrors into the iframe height — so opening the sheet
// flashed the app behind it. This overlay has ZERO document-level side effects:
// no portal-to-body, no scroll lock, no attributes on #root or the iframe. That
// property is harmless for a standalone app and required when hosted in an
// iframe, so it is always safe.
//
// One opt-in exception: when `surfaceColor` is set, the sheet repaints the
// standalone status bar via `<meta theme-color>` so the top safe-area strip
// dims in lockstep with the scrim (and restores on close). That write is NOT a
// viewport-perturbing mutation (no reflow, no scroll lock, no #root/iframe
// attribute) and a cross-origin iframe's theme-color never reaches the host's
// status bar — only the top-level document's does. So it is effective only
// standalone and an inert no-op when hosted, which keeps the property above.
//
// Dependency-free on purpose: this is a shared package, so it must not drag an
// animation library into every consumer's bundle. The drag follows the finger
// via one rAF-coalesced style write per frame (no React render); the release
// settle (snap / dismiss / the open slide-in) rides a CSS transition. translateY
// only — a compositor property — with will-change + contain bounding the work to
// the sheet.
//
// Mobile only — the caller renders a centered dialog on desktop (see
// bottom-sheet.tsx), where a sheet and its drag handle read wrong on a wide
// pointer-driven screen.

import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useRef } from "react";
import { Box } from "@mui/material";

// The sheet sizes to its content but never taller than this fraction of the
// viewport, so a strip of dimmed page always stays above it (it reads as a
// sheet, not a full-page modal).
const MAX_FRACTION = 0.88;
// The medium "peek" detent, as a fraction of the viewport.
const PEEK_FRACTION = 0.5;
// Add the peek detent only when the content-fit sheet is at least this tall
// (fraction of viewport). Below it the gap to the 0.5 peek is too small to be a
// distinct stop, so the sheet stays single-level (a confirm/short panel just
// fits its content). 0.66 ≈ keep ≥0.16vh of travel between peek and full.
const PEEK_ENABLE_FRACTION = 0.66;

// Release velocity (px/ms) projects this far forward to choose the detent; a
// downward flick faster than this dismisses instead of snapping.
const PROJECTION_MS = 110;
const FLICK_DISMISS = 0.55;
// Settle duration + easing for snap / dismiss / open. An ease-out curve that
// reads as a snappy, lightly-damped spring without a physics library.
const SETTLE_MS = 320;
const SETTLE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
// Scrim darkens as the sheet rises (0 closed → this at full).
const SCRIM_MAX = 0.45;
// Above the app chrome (banners are z=10) and the iframe. Self-contained, so a
// plain high z-index is enough; no portal/Modal stacking to coordinate with.
const Z = 1300;
const SAFE_BOTTOM = "calc(16px + env(safe-area-inset-bottom, 0px))";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// Composite an opaque `#rgb` / `#rrggbb` base UNDER black at `alpha` (0..1) →
// the colour the status bar should show so it visually matches the page scrim
// (black @ alpha painted over the same base). Returns the input unchanged if it
// isn't a hex colour, so a non-hex `surfaceColor` degrades to "no dim".
function dimHex(base: string, alpha: number): string {
  const hex = base.trim().replace(/^#/u, "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  if (full.length !== 6 || /[^0-9a-f]/iu.test(full)) {
    return base;
  }
  const f = 1 - clamp(alpha, 0, 1);
  const ch = (i: number): string =>
    Math.round(Number.parseInt(full.slice(i, i + 2), 16) * f)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

// The single document-level write this overlay permits (see header): repaint the
// standalone status bar. No-op when the meta tag is absent.
function setStatusBarColor(color: string): void {
  globalThis.document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

// Scrim opacity for a given translateY — the exact value `paint` writes to the
// scrim, factored out so the status-bar tint can be kept in lockstep with it.
function scrimOpacityAt(y: number, closedPx: number): number {
  return closedPx > 0 ? clamp((closedPx - y) / closedPx, 0, 1) * SCRIM_MAX : 0;
}

export interface DetentSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  // `| undefined` (not just `?`) so a caller compiling with
  // exactOptionalPropertyTypes can pass an explicit undefined.
  readonly ariaLabel?: string | undefined;
  /** The top bar — the drag affordance (a grab handle is prepended). Buttons in
   *  here should `stopPropagation` on pointerdown so a tap acts, not drags. */
  readonly header: ReactNode;
  /** Scrollable body below the header. */
  readonly children: ReactNode;
  /** Optional row pinned to the bottom (e.g. Save / Cancel), safe-area padded. */
  readonly footer?: ReactNode;
  /** Opaque surface colour (typically the theme's `background.paper`). When set,
   *  the standalone iOS/Android status bar is dimmed in lockstep with the scrim
   *  while open and restored on close — so the top safe-area strip stops reading
   *  as an undimmed band above the dimmed page. Omit to leave the status bar
   *  untouched (the historical zero-side-effect behaviour). Effective only
   *  standalone; an inert no-op when hosted in a cross-origin iframe (see
   *  header). */
  readonly surfaceColor?: string | undefined;
}

export function DetentSheet(
  { open, onClose, ariaLabel, header, children, footer, surfaceColor }: DetentSheetProps,
): ReactNode {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const yRef = useRef(0); // current translateY (px)
  const geomRef = useRef<{ detents: number[]; closedPx: number }>({ detents: [0, 0], closedPx: 0 });
  const dragRef = useRef<{ startPointerY: number; startY: number; samples: { t: number; y: number }[] } | null>(null);
  const rafRef = useRef(0);
  // Mirror surfaceColor into a ref so `paint` (deps []) can read the latest
  // without being re-created (which would replay the open animation).
  const surfaceColorRef = useRef(surfaceColor);
  useEffect(() => {
    surfaceColorRef.current = surfaceColor;
  }, [surfaceColor]);

  // Write translateY + scrim opacity straight to the DOM (no React render). The
  // settle rides a CSS transition; an active drag turns it off so the sheet
  // tracks the finger 1:1.
  const paint = useCallback((y: number, animate: boolean): void => {
    yRef.current = y;
    const { closedPx } = geomRef.current;
    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    if (sheet) {
      sheet.style.transition = animate ? `transform ${String(SETTLE_MS)}ms ${SETTLE_EASE}` : "none";
      sheet.style.transform = `translateY(${String(y)}px)`;
    }
    if (scrim) {
      scrim.style.transition = animate ? `opacity ${String(SETTLE_MS)}ms ${SETTLE_EASE}` : "none";
      scrim.style.opacity = String(scrimOpacityAt(y, closedPx));
    }
    // Match the status bar to the scrim, but only at settle points: iOS paints
    // `theme-color` with a hard snap (no animation), so a per-frame write during
    // the drag would jank. `animate` is true exactly on the settle transitions
    // (open / snap / dismiss); the bar then steps between detents, not per frame.
    const surface = surfaceColorRef.current;
    if (animate && surface !== undefined) {
      setStatusBarColor(dimHex(surface, scrimOpacityAt(y, closedPx)));
    }
  }, []);

  // (Re)compute geometry against the rendered content on open, then animate in.
  useEffect(() => {
    if (!open) {
      return;
    }
    const h = globalThis.innerHeight;
    // The sheet's ACTUAL rendered height — content-driven, clamped by the CSS
    // maxHeight (MAX_FRACTION vh). This is both the slide-out distance and the
    // "full" extent: opening at translateY 0 reveals the whole sheet (footer
    // included), so a short confirm shows its actions without any drag.
    // offsetHeight (not a vh computation) is exact under the iOS Safari
    // 100vh-vs-innerHeight gap, so the slide-out fully clears.
    const closedPx = sheetRef.current?.offsetHeight ?? MAX_FRACTION * h;
    // Two levels only when the content is tall enough for a peek to be a
    // distinct stop; otherwise a single content-sized level. Detents are
    // translateY values, ordered most-hidden → full (0).
    const hasPeek = closedPx >= PEEK_ENABLE_FRACTION * h;
    const detents = hasPeek ? [closedPx - PEEK_FRACTION * h, 0] : [0];
    geomRef.current = { detents, closedPx };
    const openY = detents.at(-1) ?? 0; // full
    paint(closedPx, false); // seed closed (no transition)…
    const id = globalThis.requestAnimationFrame(() => paint(openY, true)); // …then slide up
    return () => globalThis.cancelAnimationFrame(id);
  }, [open, paint]);

  const dismiss = useCallback((): void => {
    paint(geomRef.current.closedPx, true);
    globalThis.setTimeout(onClose, SETTLE_MS);
  }, [paint, onClose]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startPointerY: e.clientY, startY: yRef.current, samples: [{ t: e.timeStamp, y: e.clientY }] };
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      const d = dragRef.current;
      if (!d) {
        return;
      }
      const { closedPx } = geomRef.current;
      let y = d.startY + (e.clientY - d.startPointerY);
      if (y < 0) {
        y *= 0.12; // rubberband past the top
      }
      y = Math.min(y, closedPx);
      d.samples.push({ t: e.timeStamp, y: e.clientY });
      if (d.samples.length > 5) {
        d.samples.shift();
      }
      if (rafRef.current === 0) {
        rafRef.current = globalThis.requestAnimationFrame(() => {
          rafRef.current = 0;
          paint(y, false);
        });
      }
    },
    [paint],
  );

  const onPointerUp = useCallback((): void => {
    const d = dragRef.current;
    dragRef.current = null;
    if (rafRef.current !== 0) {
      globalThis.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (!d) {
      return;
    }
    const { detents, closedPx } = geomRef.current;
    const last = d.samples.at(-1);
    const prev = d.samples.at(-2) ?? last;
    if (!last || !prev) {
      return;
    }
    const dt = last.t - prev.t;
    const vy = dt > 0 ? (last.y - prev.y) / dt : 0; // px/ms, + = downward
    const projected = yRef.current + vy * PROJECTION_MS;
    const low = detents[0] ?? 0;
    if (vy > FLICK_DISMISS || projected > low + (closedPx - low) * 0.5) {
      dismiss();
      return;
    }
    let best = 0;
    detents.forEach((dd, i) => {
      if (Math.abs(dd - projected) < Math.abs((detents[best] ?? 0) - projected)) {
        best = i;
      }
    });
    paint(detents[best] ?? 0, true);
  }, [dismiss, paint]);

  // Escape closes — keyboard parity with a dialog, without being a Modal.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        dismiss();
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  // Status-bar tint that `paint`'s settle-only write can't cover: (1) restore
  // the undimmed surface when the sheet closes/unmounts (the caller may flip
  // `open` to false directly, without a dismiss-settle paint); (2) re-tint when
  // `surfaceColor` changes WHILE open — the settings sheet is exactly where the
  // theme (hence paper colour) is switched — keeping the bar dimmed at the
  // current detent across that change.
  useEffect(() => {
    if (!open || surfaceColor === undefined) {
      return;
    }
    setStatusBarColor(dimHex(surfaceColor, scrimOpacityAt(yRef.current, geomRef.current.closedPx)));
    return () => {
      setStatusBarColor(surfaceColor);
    };
  }, [open, surfaceColor]);

  // Unmounted when closed; the dismiss runs the settle (open still true) and
  // only then calls onClose, so the slide-out is seen.
  if (!open) {
    return null;
  }

  return (
    <>
      {
        /* Scrim: dims the app, taps dismiss. Painted imperatively (opacity tracks
          the sheet height). Self-contained — it does NOT touch #root/body. */
      }
      <Box
        ref={scrimRef}
        aria-hidden
        onClick={dismiss}
        sx={{ position: "fixed", inset: 0, bgcolor: "common.black", zIndex: Z, opacity: 0, touchAction: "none" }}
      />
      <Box
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        sx={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          // Content-driven height: as tall as the rows, capped so a scrim strip
          // always shows. The body (flex) scrolls when the content hits the cap.
          maxHeight: `${String(MAX_FRACTION * 100)}vh`,
          zIndex: Z + 1,
          willChange: "transform",
          contain: "layout paint",
          display: "flex",
          flexDirection: "column",
          bgcolor: "background.paper",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          boxShadow: 8,
          outline: "none",
          // Pre-paint: offscreen until the open effect's first frame slides it up.
          transform: "translateY(100vh)",
        }}
      >
        {
          /* Drag affordance: the whole top bar (grab strip + header) moves the
            sheet. touchAction:none so the browser doesn't claim the gesture for
            scroll/pull-to-refresh; header buttons stopPropagation so a tap acts. */
        }
        <Box
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          sx={{ flexShrink: 0, touchAction: "none", cursor: "grab" }}
        >
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 34, pt: 1 }}>
            <Box sx={{ width: 56, height: 6, borderRadius: 3, bgcolor: "text.disabled" }} />
          </Box>
          {header}
        </Box>
        {
          /* Body scrolls independently of the drag. The sheet's maxHeight caps the
            whole surface, so when the content overflows this flex child shrinks
            (minHeight:0) and scrolls; when it fits, the sheet is content-tall. */
        }
        <Box
          sx={{
            // basis:auto so the body takes its content height (the sheet fits
            // content); shrink:1 + minHeight:0 so it shrinks and scrolls only
            // once the content hits the sheet's maxHeight. NOT flex:1 (basis 0
            // would collapse the body in an auto-height container).
            flex: "0 1 auto",
            minHeight: 0,
            overflowY: "auto",
            px: 2,
            pb: footer == null ? SAFE_BOTTOM : 1,
          }}
        >
          {children}
        </Box>
        {footer == null ? null : (
          <Box
            sx={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", gap: 1, px: 2, pt: 1, pb: SAFE_BOTTOM }}
          >
            {footer}
          </Box>
        )}
      </Box>
    </>
  );
}
