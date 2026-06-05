// ImageLightbox — a fullscreen image gallery with zoom + pan, driven by pointer
// events so one code path serves mouse, touch, and pen:
//
//   - wheel / pinch          → zoom toward the cursor / pinch midpoint
//   - double click / tap     → toggle between fit and a 2.5x zoom
//   - drag (zoomed in)       → pan
//   - drag sideways (at fit) → previous / next image
//   - drag down (at fit)     → swipe-to-dismiss, backdrop fades with distance
//   - ← / → arrows           → previous / next image
//   - backdrop tap / Esc / ✕ → close
//
// The gesture machinery lives in ./image-lightbox-gestures (imperative refs
// written straight to the DOM, no React re-render per frame); this file is the
// presentation + the open/index plumbing.
//
// Document side effects, deliberately scoped: this DOES `createPortal` to
// document.body — a fullscreen lightbox must escape any transformed /
// `overflow:hidden` ancestor to cover the viewport, and portal alone appends a
// fixed node without touching body overflow or `#root`. It does NOT lock body
// scroll (no `document.body.style.overflow`): that mutation perturbs the iOS
// visual viewport, which a cross-origin portal host mirrors into the iframe
// height — the same flash the sheet primitives avoid. `touchAction: none` on the
// overlay + image blocks touch-scrolling the background instead.
//
// Business-free: presentational only. The caller owns the gallery array and the
// open/index state.

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Box, IconButton } from "@mui/material";
import { useLightboxGestures } from "./image-lightbox-gestures.ts";

export interface GalleryImage {
  src: string;
  alt: string;
}

export interface ImageLightboxProps {
  /** All zoomable images in the current context, in reading order. */
  images: GalleryImage[];
  /** Index of the open image, or `null` to keep the lightbox closed. */
  index: number | null;
  /** Request a different image (prev/next, swipe, arrow keys). */
  onIndex: (index: number) => void;
  onClose: () => void;
  /**
   * Paint a white plate (background + padding) behind the image. ON by default:
   * white-bg diagrams and transparent line art would glare or vanish on the
   * near-black backdrop, so docs/figure galleries want it. Set `false` for
   * arbitrary screenshots / photos (e.g. a chat transcript) where a white frame
   * looks wrong.
   */
  plate?: boolean;
}

export function ImageLightbox(props: ImageLightboxProps): React.JSX.Element | null {
  const { images, index, onIndex, onClose, plate = true } = props;
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const open = index !== null && index >= 0 && index < images.length;
  const current = open && index !== null ? images[index] : undefined;
  const src = current?.src ?? null;
  const canPrev = open && index !== null && index > 0;
  const canNext = open && index !== null && index < images.length - 1;

  const goPrev = useCallback(() => {
    if (index !== null && index > 0) {
      onIndex(index - 1);
    }
  }, [index, onIndex]);
  const goNext = useCallback(() => {
    if (index !== null && index < images.length - 1) {
      onIndex(index + 1);
    }
  }, [index, images.length, onIndex]);

  const { onPointerDown, onPointerMove, onPointerEnd, zoomBy } = useLightboxGestures({
    imgRef,
    overlayRef,
    open,
    src,
    canPrev,
    canNext,
    goPrev,
    goNext,
    onClose,
  });

  // Key shortcuts while open. No body-scroll lock — see the file header.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        goPrev();
      } else if (e.key === "ArrowRight") {
        goNext();
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, goPrev, goNext]);

  // Tapping the black backdrop closes. Guard on the target being the overlay
  // itself so taps on the image (and on the dock bar in front) don't count.
  const onBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  }, [onClose]);

  if (!open || index === null || current === undefined) {
    return null;
  }

  return createPortal(
    <Box
      ref={overlayRef}
      onClick={onBackdropClick}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        backgroundColor: "rgba(0, 0, 0, 0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        touchAction: "none",
        "@keyframes shared-lightbox-in": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        animation: "shared-lightbox-in 0.18s ease",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <img
        ref={imgRef}
        src={current.src}
        alt={current.alt}
        draggable={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: "zoom-out",
          willChange: "transform",
          // The white plate (see `plate` prop): docs/figures need it so white-bg
          // diagrams don't glare and transparent line art doesn't vanish on the
          // near-black backdrop; photos/screenshots opt out.
          backgroundColor: plate ? "#ffffff" : "transparent",
          padding: plate ? "0.5rem" : 0,
          borderRadius: "6px",
          boxSizing: "border-box",
        }}
      />

      {
        /* One bottom dock holds every control, within the thumb's reach on a
          phone (and a single obvious cluster on desktop). Order mirrors how a
          hand sweeps the arc: navigate · zoom · close, split by hairlines so a
          reach for "next" doesn't fat-finger "close". Tapping the black backdrop
          also dismisses (see onBackdropClick); Close, Esc, and swipe-down work
          too. The dock is click-through except on the bar itself, so a tap
          beside it falls to the image. */
      }
      <div style={dockStyle}>
        {current.alt ? <div style={captionStyle}>{current.alt}</div> : null}
        <div style={barStyle}>
          {images.length > 1
            ? (
              <>
                <IconButton aria-label="Previous image" onClick={goPrev} disabled={!canPrev} sx={ctrlBtnSx(30)}>
                  ‹
                </IconButton>
                <span style={counterStyle}>
                  {index + 1} / {images.length}
                </span>
                <IconButton aria-label="Next image" onClick={goNext} disabled={!canNext} sx={ctrlBtnSx(30)}>
                  ›
                </IconButton>
                <span style={dividerStyle} />
              </>
            )
            : null}
          <IconButton aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)} sx={ctrlBtnSx(26)}>
            −
          </IconButton>
          <IconButton aria-label="Zoom in" onClick={() => zoomBy(1.5)} sx={ctrlBtnSx(24)}>
            +
          </IconButton>
          <span style={dividerStyle} />
          <IconButton aria-label="Close" onClick={onClose} sx={ctrlBtnSx(22)}>
            ✕
          </IconButton>
        </div>
      </div>
    </Box>,
    document.body,
  );
}

// The control dock pinned to the bottom of the viewport. It spans the width and
// centres its children (caption above the bar), but is click-through
// (pointerEvents: none) so only the bar swallows taps — everywhere else falls to
// the image. Insets are floored on all four edges so the bar clears the iOS home
// indicator and landscape rounded corners (ui.md §7).
const dockStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
  paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)",
  paddingLeft: "max(env(safe-area-inset-left, 0px), 12px)",
  paddingRight: "max(env(safe-area-inset-right, 0px), 12px)",
  pointerEvents: "none",
};

// The control bar: a single translucent, blurred pill so the buttons stay
// legible over any image. This is the only pointer-catching surface in the dock.
const barStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  padding: 6,
  maxWidth: "100%",
  borderRadius: 999,
  background: "rgba(0, 0, 0, 0.55)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  pointerEvents: "auto",
};

// A 44px round MUI IconButton (the iOS minimum tap target) with the standard
// ripple. `glyph` tunes the font size per icon so the arrows read larger than
// the +/−/✕. Disabled ends fade rather than vanish so the bar keeps a stable
// width. White on the dark dock, regardless of theme.
function ctrlBtnSx(glyph: number): NonNullable<React.ComponentProps<typeof IconButton>["sx"]> {
  return {
    flex: "0 0 auto",
    width: 44,
    height: 44,
    padding: 0,
    fontSize: glyph,
    lineHeight: 1,
    color: "#fff",
    "&:hover": { backgroundColor: "rgba(255,255,255,0.12)" },
    "&.Mui-disabled": { color: "rgba(255,255,255,0.3)" },
  };
}

const counterStyle: React.CSSProperties = {
  flex: "0 0 auto",
  padding: "0 6px",
  color: "#fff",
  fontSize: 13,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  userSelect: "none",
};

// Hairline between control groups (nav | zoom | close), so a reach for one group
// doesn't land on the next.
const dividerStyle: React.CSSProperties = {
  flex: "0 0 auto",
  width: 1,
  height: 22,
  margin: "0 4px",
  background: "rgba(255, 255, 255, 0.25)",
};

const captionStyle: React.CSSProperties = {
  maxWidth: "min(90vw, 680px)",
  padding: "4px 12px",
  borderRadius: 999,
  background: "rgba(0, 0, 0, 0.55)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  color: "#fff",
  fontSize: 13,
  lineHeight: 1.4,
  textAlign: "center",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  pointerEvents: "none",
};
