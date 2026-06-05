// Pointer/zoom/pan machinery for <ImageLightbox>, split out so the component
// file stays small and each function stays well under the line caps. All state
// is imperative (refs written straight to the DOM for 60fps gestures); the only
// React surface is the handlers this hook returns.

import { type RefObject, useCallback, useEffect, useRef } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
// Vertical drag (at 1x) past this many px releases into a dismiss.
const DISMISS_THRESHOLD = 110;
// Horizontal drag (at 1x) past this many px flips to the prev/next image.
const SWIPE_NAV_THRESHOLD = 70;
// Pointer travel below this (px) counts as a tap, not a drag.
const TAP_SLOP = 8;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SCALE = 2.5;

export interface LightboxGesturesParams {
  imgRef: RefObject<HTMLImageElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  /** Whether the lightbox is currently showing an image. */
  open: boolean;
  /** Source of the current image; a change resets the view. */
  src: string | null;
  canPrev: boolean;
  canNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  onClose: () => void;
}

export interface LightboxGestures {
  onPointerDown: (e: React.PointerEvent<HTMLImageElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLImageElement>) => void;
  onPointerEnd: (e: React.PointerEvent<HTMLImageElement>) => void;
  /** Step zoom toward the viewport centre (the dock +/− buttons). */
  zoomBy: (factor: number) => void;
}

const clamp = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function useLightboxGestures(params: LightboxGesturesParams): LightboxGestures {
  const { imgRef, overlayRef, open, src, canPrev, canNext, goPrev, goNext, onClose } = params;

  // Drops the `will-change` hint once motion settles (see applyTransform). 0 ==
  // "no pending timer" (a browser timer id is never 0), matching the repo idiom.
  const settleTimer = useRef(0);
  // Live transform, applied imperatively for 60fps gestures.
  const tf = useRef({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: 0,
    pinchDist: 0,
    pinchScale: 1,
    lastTapTime: 0,
  });

  const applyTransform = useCallback((animate = false) => {
    const img = imgRef.current;
    if (!img) {
      return;
    }
    const { scale, x, y } = tf.current;
    img.style.transition = animate ? "transform 0.22s ease" : "none";
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    img.style.cursor = scale > 1 ? "grab" : "zoom-out";
    // Promote to a compositor layer for smooth gestures, then drop the hint once
    // motion settles. A permanent `will-change: transform` pins the image to a
    // raster cached at 1x size, so `scale()` GPU-upscales that low-res bitmap →
    // blurry zoom. Clearing it lets the browser re-rasterize at the zoomed
    // scale, which is crisp.
    img.style.willChange = "transform";
    if (settleTimer.current !== 0) {
      clearTimeout(settleTimer.current);
    }
    // Cast: setTimeout returns `number` in the browser/Deno but `NodeJS.Timeout`
    // when a consumer's tsconfig pulls in @types/node — store the browser id.
    settleTimer.current = globalThis.setTimeout(() => {
      img.style.willChange = "auto";
    }, animate ? 260 : 140) as unknown as number;
  }, [imgRef]);

  const setBackdrop = useCallback((dimAlpha: number) => {
    const o = overlayRef.current;
    if (o) {
      o.style.backgroundColor = `rgba(0, 0, 0, ${dimAlpha})`;
    }
  }, [overlayRef]);

  const reset = useCallback((animate = false) => {
    tf.current = { scale: 1, x: 0, y: 0 };
    applyTransform(animate);
    setBackdrop(0.92);
  }, [applyTransform, setBackdrop]);

  // Zoom by `factor` keeping the viewport point (cx, cy) stationary.
  const zoomAt = useCallback((opts: { factor: number; cx: number; cy: number; animate?: boolean }) => {
    const img = imgRef.current;
    if (!img) {
      return;
    }
    const prev = tf.current.scale;
    const next = clamp(prev * opts.factor);
    if (next === prev) {
      return;
    }
    const rect = img.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const ratio = next / prev;
    tf.current.x += (opts.cx - centerX) * (1 - ratio);
    tf.current.y += (opts.cy - centerY) * (1 - ratio);
    tf.current.scale = next;
    if (next === MIN_SCALE) {
      tf.current.x = 0;
      tf.current.y = 0;
    }
    applyTransform(opts.animate ?? false);
  }, [imgRef, applyTransform]);

  const zoomBy = useCallback((factor: number) => {
    zoomAt({ factor, cx: globalThis.innerWidth / 2, cy: globalThis.innerHeight / 2, animate: true });
  }, [zoomAt]);

  // New image (open or navigation) → reset the view.
  useEffect(() => {
    if (src) {
      reset();
    }
  }, [src, reset]);

  // Wheel zoom (passive:false so we can preventDefault the page scroll).
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !open) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt({ factor: e.deltaY < 0 ? 1.18 : 1 / 1.18, cx: e.clientX, cy: e.clientY });
    };
    img.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      img.removeEventListener("wheel", onWheel);
    };
  }, [imgRef, open, src, zoomAt]);

  // Clear any pending settle timer on unmount.
  useEffect(() => () => {
    if (settleTimer.current !== 0) {
      clearTimeout(settleTimer.current);
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = g.current;
    if (pointers.current.size === 1) {
      st.startX = e.clientX;
      st.lastX = e.clientX;
      st.startY = e.clientY;
      st.lastY = e.clientY;
      st.moved = 0;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) {
        st.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        st.pinchScale = tf.current.scale;
      }
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (!pointers.current.has(e.pointerId)) {
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = g.current;

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b && st.pinchDist > 0) {
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const target = clamp((st.pinchScale * dist) / st.pinchDist);
        zoomAt({ factor: target / tf.current.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });
      }
      return;
    }

    const dx = e.clientX - st.lastX;
    const dy = e.clientY - st.lastY;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    st.moved += Math.abs(dx) + Math.abs(dy);

    if (tf.current.scale > 1) {
      // Pan the zoomed image.
      tf.current.x += dx;
      tf.current.y += dy;
      applyTransform();
    } else {
      // At fit: follow the finger on both axes. The release handler decides
      // whether the dominant axis means navigate (horizontal) or dismiss
      // (vertical). Only vertical travel fades the backdrop.
      tf.current.x = e.clientX - st.startX;
      tf.current.y = e.clientY - st.startY;
      applyTransform();
      setBackdrop(0.92 * (1 - Math.min(1, Math.abs(tf.current.y) / 400)));
    }
  }, [zoomAt, applyTransform, setBackdrop]);

  const onPointerEnd = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      return; // still pinching
    }
    const st = g.current;

    if (tf.current.scale <= 1) {
      const { x, y } = tf.current;
      // Horizontal swipe wins when it dominates → previous / next image.
      if (Math.abs(x) > Math.abs(y) && Math.abs(x) > SWIPE_NAV_THRESHOLD) {
        const moved = x > 0 ? canPrev : canNext;
        if (moved) {
          if (x > 0) {
            goPrev();
          } else {
            goNext();
          }
          return; // index change resets the view
        }
        reset(true); // at an end — rubber-band back
        return;
      }
      // Vertical drag far enough → dismiss.
      if (Math.abs(y) > DISMISS_THRESHOLD) {
        onClose();
        return;
      }
    }

    if (st.moved < TAP_SLOP) {
      // Tap: double-tap toggles zoom; a lone tap on the image is ignored
      // (backdrop taps close — see the overlay handler).
      const now = Date.now();
      if (now - st.lastTapTime < DOUBLE_TAP_MS) {
        st.lastTapTime = 0;
        if (tf.current.scale > 1) {
          reset(true);
        } else {
          zoomAt({ factor: DOUBLE_TAP_SCALE, cx: e.clientX, cy: e.clientY, animate: true });
        }
      } else {
        st.lastTapTime = now;
      }
      return;
    }

    // A short drag that didn't dismiss / navigate → snap back to fit.
    if (tf.current.scale <= 1) {
      reset(true);
    }
  }, [onClose, reset, zoomAt, canPrev, canNext, goPrev, goNext]);

  return { onPointerDown, onPointerMove, onPointerEnd, zoomBy };
}
