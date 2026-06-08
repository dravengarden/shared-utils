// NavShell — the unified app-navigation primitive.
//
// One nav behavior for every app, and NO floating affordances (they read as
// gimmicky and, over a reading column, hurt usability). The shape:
//
//   • A thin bar (a solid flex sibling by default) holds the menu toggle,
//     the title, and app actions. It sits at the top by default; `barPosition`
//     can drop it to the bottom for a mobile-browser-style bar.
//   • Desktop (≥ breakpoint): a persistent left sidebar with the app's nav
//     body. The toggle collapses it to just the content; collapsed, the toggle
//     becomes a hamburger that brings it back.
//   • Mobile (< breakpoint): the toggle opens the same nav body in a
//     TOP-anchored drawer that slides down full-width.
//
// The shell owns the frame + responsive state (+ collapse persistence); each
// app supplies its nav body via `nav` and its content via `children`, so apps
// stay distinct while the chrome is identical.
//
// `barFrosted` (opt-in, default OFF) turns the bar into an iOS-style frosted-
// glass OVERLAY that content scrolls UNDER, instead of the solid flex sibling.
// Only apps that want translucency (liveview's reader) pass it; every other app
// (cowboy, …) keeps the solid bar with byte-for-byte the same behavior. When on,
// the bar is `position:absolute` pinned to its edge over a `position:relative`
// content region, and its measured height is published as the CSS custom
// property `--shell-bar-h` on that region so the app's scrollers can pad by it
// (so content clears the floating bar yet still scrolls under it).

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import MenuIcon from "@mui/icons-material/Menu";
import { alpha, Box, Drawer, IconButton, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { DetentSheet } from "./detent-sheet.tsx";

// Width below which nav collapses to a hamburger + top drawer. `lg` (1200px),
// not MUI's `sm`: tablets — iPad portrait (768–834) and landscape (1024–1180) —
// and an embedding iframe (which eats horizontal room) should all get the
// drawer rather than a cramped desktop sidebar.
type Breakpoint = "sm" | "md" | "lg" | "xl";

/** Handed to the `nav` render-prop so the body can drive the shell. */
export interface NavShellApi {
  /** Close the mobile top drawer (call after the user picks a nav item). */
  readonly closeMobile: () => void;
  /** True while the viewport is in mobile (top-drawer) mode. */
  readonly isMobile: boolean;
}

export interface NavShellProps {
  /** localStorage namespace for the persisted desktop-collapsed flag. */
  readonly appKey: string;
  /** Shown in the top bar (e.g. the app or current doc name). */
  readonly title?: ReactNode;
  /** Desktop expanded sidebar width in px. Default 280. */
  readonly navWidth?: number;
  /** Viewport width below which nav is a top drawer. Default "lg". */
  readonly breakpoint?: Breakpoint;
  /** The navigation body. Render-prop receives {@link NavShellApi}. */
  readonly nav: (api: NavShellApi) => ReactNode;
  /** App-specific top-bar actions (e.g. settings), placed at the bar's end. */
  readonly actions?: ReactNode;
  /** Where the bar sits. Default "top". "bottom" makes it a mobile-browser-style
   *  bottom bar (the content fills above it, the nav drawer slides UP from it),
   *  and the bar owns the home-indicator inset instead of the notch. Apps gate
   *  this on their own mobile tier — desktop is best left "top". */
  readonly barPosition?: "top" | "bottom";
  /** Opt-in (default OFF). When true the bar is an iOS-style frosted-glass
   *  OVERLAY that content scrolls UNDER, not a solid flex sibling: it's pinned
   *  absolute to its edge over the content region, and its rendered height is
   *  published as `--shell-bar-h` on that region so the app's scrollers can
   *  reserve space (`padding-{top,bottom}: var(--shell-bar-h)`). OFF keeps the
   *  unchanged solid-sibling bar. */
  readonly barFrosted?: boolean;
  /** The main content area. */
  readonly children: ReactNode;
}

function loadCollapsed(appKey: string): boolean {
  return globalThis.localStorage.getItem(`${appKey}-nav-collapsed`) === "true";
}

function saveCollapsed(appKey: string, collapsed: boolean): void {
  globalThis.localStorage.setItem(`${appKey}-nav-collapsed`, String(collapsed));
}

export function NavShell(props: NavShellProps): ReactNode {
  const {
    appKey,
    title,
    navWidth = 280,
    breakpoint = "lg",
    nav,
    actions,
    barPosition = "top",
    barFrosted = false,
    children,
  } = props;
  const bottom = barPosition === "bottom";
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down(breakpoint));

  // Frosted overlay: measure the bar's RENDERED height (it varies with the
  // safe-area inset, dynamic title content, and rotation) and publish it as
  // `--shell-bar-h` on the content region, so the app's scrollers can pad by an
  // always-exact value rather than a guessed constant. A ResizeObserver keeps it
  // live; off (the solid path) neither ref is wired, so this costs nothing.
  const barRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!barFrosted) {
      return;
    }
    const barEl = barRef.current;
    const contentEl = contentRef.current;
    if (!barEl || !contentEl) {
      return;
    }
    const publish = (): void => {
      contentEl.style.setProperty("--shell-bar-h", `${barEl.offsetHeight}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(barEl);
    return () => {
      ro.disconnect();
    };
  }, [barFrosted]);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(appKey));

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  // Leaving mobile (rotate / resize to desktop) drops the temporary drawer so
  // it can't linger as a stuck overlay or auto-reopen on return. React's
  // adjust-state-during-render-on-change pattern — NOT an effect: a synchronous
  // setState inside an effect triggers a cascading render (the React Compiler
  // flags it), and this is the documented alternative.
  const [wasMobile, setWasMobile] = useState(isMobile);
  if (wasMobile !== isMobile) {
    setWasMobile(isMobile);
    if (!isMobile && mobileOpen) {
      setMobileOpen(false);
    }
  }

  // The toggle: on mobile it opens the top drawer; on desktop it collapses /
  // expands the persistent sidebar (persisting the choice).
  const sidebarShown = !isMobile && !collapsed;
  const onToggle = useCallback(() => {
    if (isMobile) {
      setMobileOpen((v) => !v);
      return;
    }
    setCollapsed((v) => {
      const next = !v;
      saveCollapsed(appKey, next);
      return next;
    });
  }, [appKey, isMobile]);

  const navBody = nav({ closeMobile, isMobile });

  // Bottom bar: pad top AND bottom by the SAME trimmed home-indicator inset, so
  // the content sits vertically centred in the bar (a one-sided bottom inset
  // pushes it up and reads as "not centred"), while still clearing the
  // indicator. Trimmed well below the full inset so the bar isn't bottom-heavy.
  const bottomPad = "max(calc(env(safe-area-inset-bottom, 0px) - 22px), 6px)";

  // A string title gets the default single-line styling; a node title is
  // rendered raw in the slot, so an app can stack two lines (e.g. a chapter over
  // its book) or supply its own chrome.
  let titleSlot: ReactNode = <Box sx={{ flex: 1 }} />;
  if (typeof title === "string") {
    titleSlot = (
      <Typography
        variant="subtitle2"
        noWrap
        sx={{ fontWeight: 600, minWidth: 0, flex: 1 }}
      >
        {title}
      </Typography>
    );
  } else if (title != null) {
    titleSlot = (
      <Box
        sx={{
          minWidth: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {title}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        overflow: "hidden",
      }}
    >
      <Box
        component="header"
        ref={barFrosted ? barRef : undefined}
        sx={{
          flexShrink: 0,
          // Bottom mode flips the bar below the content via flex order (one
          // bar, not a second element), so reading order in the DOM is stable.
          // (Frosted overrides position to absolute below; `order` is harmless
          // on an absolute box and keeps the non-frosted path untouched.)
          order: bottom ? 2 : 0,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          // Keep the end buttons (menu / actions) off the screen edge so they
          // clear the display's rounded corners and a landscape notch — pull in
          // the safe-area inset, floored to a comfortable 12px in portrait.
          pl: "max(env(safe-area-inset-left, 0px), 12px)",
          pr: "max(env(safe-area-inset-right, 0px), 12px)",
          minHeight: 48,
          // Separator: a top bar floats over the content (Material elevation,
          // shadow falling down). A BOTTOM bar gets a flat 1px divider instead —
          // an upward drop-shadow there reads heavy and muddy over the reading
          // surface; a hairline rule is the cleaner, calmer cut. position+zIndex
          // so a top bar's shadow paints over the content (flex siblings would
          // otherwise share a layer).
          zIndex: (t) => t.zIndex.appBar,
          // Top bar owns the notch (pt only). Bottom bar is padded symmetrically
          // (see bottomPad) so its content is vertically centred and clears the
          // home indicator.
          pt: bottom ? bottomPad : "env(safe-area-inset-top, 0px)",
          pb: bottom ? bottomPad : 0,
          ...(barFrosted
            ? {
              // Frosted overlay: pin the bar absolute to its edge OVER the
              // (position:relative) content region, so the scroller fills
              // full-height under it. Higher alpha than the status-bar strip
              // (0.78 vs 0.5) because real body text scrolls under THIS bar —
              // the controls' own legibility comes first; blur+saturate match
              // the status strip so the two read as one glass layer. Use
              // background.default (the page bg the text sits on), not paper.
              // Keep the edge: a top bar's downward shadow / a bottom bar's
              // hairline still marks the boundary over a busy column.
              position: "absolute",
              left: 0,
              right: 0,
              ...(bottom ? { bottom: 0 } : { top: 0 }),
              bgcolor: (t) => alpha(t.palette.background.default, 0.78),
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              boxShadow: bottom ? "none" : 3,
              ...(bottom ? { borderTop: 1, borderColor: "divider" } : {}),
            }
            : {
              position: "relative",
              bgcolor: "background.paper",
              boxShadow: bottom ? "none" : 3,
              ...(bottom ? { borderTop: 1, borderColor: "divider" } : {}),
            }),
        }}
      >
        <Tooltip title={sidebarShown ? "Collapse" : "Menu"}>
          {
            /* Primary mobile nav opener — ≥40px target on touch, compact on
              desktop. */
          }
          <IconButton
            aria-label="toggle navigation"
            onClick={onToggle}
            size="small"
            sx={{ width: { xs: 40, lg: 36 }, height: { xs: 40, lg: 36 } }}
          >
            {sidebarShown ? <ChevronLeftIcon /> : <MenuIcon />}
          </IconButton>
        </Tooltip>
        {titleSlot}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            flexShrink: 0,
          }}
        >
          {actions}
        </Box>
      </Box>

      <Box
        ref={barFrosted ? contentRef : undefined}
        sx={{
          order: bottom ? 1 : 0,
          display: "flex",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          // Frosted: this region is the bar's positioning context (the bar is
          // absolute within it) AND carries the published --shell-bar-h that the
          // app's scrollers pad by. The solid path leaves it static (unchanged).
          ...(barFrosted ? { position: "relative" } : {}),
        }}
      >
        {sidebarShown && (
          <Box
            sx={{
              flexShrink: 0,
              width: navWidth,
              height: "100%",
              borderRight: 1,
              borderColor: "divider",
              bgcolor: "background.paper",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {navBody}
          </Box>
        )}

        {
          /* Mobile nav body. A bottom bar presents it as the momentum
            DetentSheet (drag handle, rounded top, swipe-to-dismiss) — the same
            sheet every other bottom-anchored surface uses, so it feels native
            and consistent. A top bar keeps the plain top Drawer that slides
            down from under it. */
        }
        {bottom
          ? (
            <DetentSheet
              open={isMobile && mobileOpen}
              onClose={closeMobile}
              ariaLabel="Navigation"
            >
              {navBody}
            </DetentSheet>
          )
          : (
            <Drawer
              anchor="top"
              open={isMobile && mobileOpen}
              onClose={closeMobile}
              ModalProps={{ keepMounted: true }}
              slotProps={{
                paper: {
                  sx: {
                    maxHeight: "85dvh",
                    pt: "env(safe-area-inset-top, 0px)",
                    display: "flex",
                    flexDirection: "column",
                  },
                },
              }}
            >
              {navBody}
            </Drawer>
          )}

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
