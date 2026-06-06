// BottomSheet — the unified modal-sheet primitive.
//
// One affordance, two surfaces by viewport:
//   • mobile (< sm): the shared DetentSheet — a momentum two-detent sheet that
//     slides up from the bottom (drag the bar to expand, flick down to dismiss).
//   • desktop (≥ sm): a centered MUI Dialog — a sheet + drag handle read wrong
//     on a wide, pointer-driven screen.
//
// The mobile feel lives entirely in DetentSheet (dep-free, non-Modal so it never
// perturbs a hosted iframe). BottomSheet just maps its title/children/actions
// onto DetentSheet's header/body/footer, so every app's modal sheet shares the
// exact same behaviour. Every app's modal sheet should use THIS, not a bespoke
// Drawer.

import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { ReactNode } from "react";

import { DetentSheet } from "./detent-sheet.tsx";

export interface BottomSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Heading shown at the top of the sheet/dialog. */
  readonly title?: ReactNode;
  /** Body content (scrolls when it overflows the sheet). */
  readonly children: ReactNode;
  /** Optional action row pinned to the bottom (e.g. Save / Cancel). */
  readonly actions?: ReactNode;
  /**
   * Desktop/tablet dialog width. Default is a compact ~444px dialog (right for
   * a handful of rows). Pass `wide` for content-rich surfaces (a palette grid +
   * font list + reading controls) so the dialog scales with the viewport
   * instead of staying cramped: ~560px on tablets, ~720px on wide desktops,
   * still shrinking to fit a narrow tablet. No effect on the mobile sheet.
   */
  readonly wide?: boolean;
  /**
   * Force the bottom-sheet surface regardless of viewport width. Default is
   * width-driven (sheet `< sm`, centered dialog otherwise). Set this when the
   * host puts its chrome at the bottom on a wider tier too (e.g. a mobile-
   * browser-style bottom navbar on a tablet), so its modals keep rising from
   * the bottom instead of switching to a centered dialog.
   */
  readonly forceSheet?: boolean;
}

export function BottomSheet(
  { open, onClose, title, children, actions, wide = false, forceSheet = false }: BottomSheetProps,
): ReactNode {
  const theme = useTheme();
  // useMediaQuery must run unconditionally (rules of hooks); OR with forceSheet
  // after.
  const widthIsMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isMobile = forceSheet || widthIsMobile;

  // Desktop: a centered dialog. A bottom sheet (and its drag handle) only makes
  // sense on a touch/phone viewport. `fullWidth` + a Paper maxWidth cap lets the
  // dialog fill the viewport up to the cap, so narrow tablets shrink it while
  // wide screens get the full width — `wide` raises the cap per breakpoint.
  if (!isMobile) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth={false}
        fullWidth
        PaperProps={{ sx: { maxWidth: wide ? { sm: 560, lg: 720 } : 444 } }}
      >
        {title == null ? null : <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>}
        <DialogContent>{children}</DialogContent>
        {actions == null
          ? null
          : <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, px: 3, pb: 2 }}>{actions}</Box>}
      </Dialog>
    );
  }

  // Mobile: the shared momentum sheet. The title row rides the drag bar; its
  // close button stops pointerdown so a tap closes instead of starting a drag.
  return (
    <DetentSheet
      open={open}
      onClose={onClose}
      ariaLabel={typeof title === "string" ? title : undefined}
      // Dim the standalone status bar in lockstep with the scrim: the sheet's
      // surface is `background.paper`, so the top safe-area strip matches the
      // dimmed page instead of staying a bright band. Inert when hosted.
      surfaceColor={theme.palette.background.paper}
      header={title == null ? <Box sx={{ pb: 0.5 }} /> : (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            pl: 2,
            // The close button is the sheet's primary dismiss; on a phone it sits
            // at the right edge. Drop edge="end" (its negative margin pinned the
            // small glyph to the iOS rounded corner / back-swipe edge) and floor a
            // right inset instead.
            pr: "max(env(safe-area-inset-right), 16px)",
            pb: 1,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flexGrow: 1 }}>
            {title}
          </Typography>
          <IconButton
            aria-label="close"
            size="small"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            // ≥40px target on touch (the close affordance every sheet shares);
            // compact on desktop.
            sx={{ width: { xs: 40, lg: 34 }, height: { xs: 40, lg: 34 } }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
      footer={actions ?? undefined}
    >
      {children}
    </DetentSheet>
  );
}
