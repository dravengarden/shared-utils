// SettingsSheet — the unified settings affordance.
//
// A gear button that opens the SAME settings surface everywhere, only the
// container adapts to the viewport:
//   • mobile (< sm): a bottom sheet that slides up from the bottom edge.
//   • desktop (≥ sm): a centered dialog.
//
// Apps fill it with their own settings rows via `children` (e.g. the shared
// ThemeModeControl). Keeping the gear + surface here means every app's settings
// look and behave identically.

import SettingsIcon from "@mui/icons-material/Settings";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import CloseIcon from "@mui/icons-material/Close";
import { Box, IconButton, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";

import { BottomSheet } from "./bottom-sheet.tsx";
import { DetentSheet } from "./detent-sheet.tsx";
import type { ThemeChoice } from "./theme-types.ts";

export interface SettingsSheetProps {
  /** Heading at the top of the sheet/dialog. Default "Settings". */
  readonly title?: string;
  /** Settings rows — e.g. a {@link ThemeModeControl}. */
  readonly children: ReactNode;
  /** Widen the desktop/tablet dialog for content-rich settings (see
   *  {@link BottomSheet}'s `wide`). No effect on the mobile sheet. */
  readonly wide?: boolean;
  /** Render the settings in a near-full-screen **frosted-glass cover** sheet
   *  (the {@link DetentSheet} `cover` variant — 微信读书 / iOS pageSheet feel,
   *  the page diffuses through the glass) instead of the default solid
   *  BottomSheet. Opt-in so apps that want the lighter sheet are unchanged. */
  readonly cover?: boolean;
}

/**
 * The gear + responsive settings surface. Drop it into a top-bar `actions` slot
 * (or any chrome); it owns its own open/close state.
 */
export function SettingsSheet(
  { title = "Settings", children, wide = false, cover = false }: SettingsSheetProps,
): ReactNode {
  const [open, setOpen] = useState(false);
  const close = (): void => {
    setOpen(false);
  };
  // The cover path renders straight into DetentSheet, which imposes NO side
  // gutter (so edge-to-edge lists/charts work), so the cover body carries its own
  // px:2 — the same gutter BottomSheet already wraps the non-cover path in (hence
  // px only when `cover`, else the non-cover body would be double-padded).
  const body = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, ...(cover ? { px: 2 } : {}) }}>
      {children}
    </Box>
  );

  return (
    <>
      <Tooltip title="Settings">
        {
          /* Why the sm tier is bigger (48 vs 40/36): on a tablet (iPad) the gear
            sits near a rounded screen corner and is hard to hit at 40px. sm=600
            (MUI default) → tablet/iPad gets a 48px target; iPhone portrait (<600)
            stays 40; desktop (≥1200) stays the compact 36. */
        }
        <IconButton
          aria-label="settings"
          onClick={() => setOpen(true)}
          size="small"
          sx={{ width: { xs: 40, sm: 48, lg: 36 }, height: { xs: 40, sm: 48, lg: 36 } }}
        >
          {
            /* `1.5rem` (the MUI default), to MATCH the ≡ nav toggle in NavShell —
              its `MenuIcon` carries no `fontSize`, so it renders at the rem-based
              default and grows when a host scales its root font. The gear used to
              be FIXED px ("chrome stays put"), but that left the two end controls
              visibly mismatched once the font was scaled up (the ≡ grew, the gear
              didn't). Keeping both on the same rem default makes them identical at
              every scale. 1.5rem == 24px at scale 1, so the iPad tap target stays
              well-filled and unscaled apps see no change. */
          }
          <SettingsIcon sx={{ fontSize: "1.5rem" }} />
        </IconButton>
      </Tooltip>
      {cover
        ? (
          /* Frosted-glass cover sheet: the page diffuses through the glass; the
            header carries the title + a close ✕ (stopPropagation so the tap acts
            instead of dragging the sheet). DetentSheet draws the grab handle. */
          <DetentSheet
            open={open}
            onClose={close}
            cover
            ariaLabel={title}
            header={
              // px:2 to match the body gutter — DetentSheet's header strip is
              // edge-to-edge, so the title + close ✕ would otherwise hug the screen.


                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flex: 1,
                    minWidth: 0,
                    px: 2,
                  }}
                >
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>{title}</Typography>
                  <IconButton
                    aria-label="Close"
                    size="small"
                    onClick={close}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>

            }
          >
            {body}
          </DetentSheet>
        )
        : (
          /* The shared BottomSheet owns the responsive surface (drag-resizable
            sheet on mobile, dialog on desktop) + safe-area padding. */
          <BottomSheet open={open} onClose={close} title={title} wide={wide}>
            {body}
          </BottomSheet>
        )}
    </>
  );
}

const THEME_CHOICES: readonly { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: "system", label: "System", icon: <SettingsBrightnessIcon fontSize="small" /> },
  { value: "light", label: "Light", icon: <LightModeIcon fontSize="small" /> },
  { value: "dark", label: "Dark", icon: <DarkModeIcon fontSize="small" /> },
];

/**
 * Shared theme picker: a System / Light / Dark segmented control. Goes inside a
 * {@link SettingsSheet}. Identical in every app so theme selection feels the
 * same product-wide.
 */
export function ThemeModeControl(props: {
  readonly value: ThemeChoice;
  readonly onChange: (value: ThemeChoice) => void;
}): ReactNode {
  const { value, onChange } = props;
  return (
    <Box>
      <Typography variant="overline" sx={{ color: "text.secondary", display: "block", mb: 0.5 }}>
        Theme
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        fullWidth
        size="small"
        onChange={(_e, next: ThemeChoice | null) => {
          // null = the active button was re-clicked; keep the current choice.
          if (next !== null) {
            onChange(next);
          }
        }}
      >
        {THEME_CHOICES.map((c) => (
          <ToggleButton key={c.value} value={c.value} sx={{ gap: 0.5, textTransform: "none" }}>
            {c.icon}
            {c.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}
