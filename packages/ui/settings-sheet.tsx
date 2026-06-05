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
import { Box, IconButton, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";

import { BottomSheet } from "./bottom-sheet.tsx";
import type { ThemeChoice } from "./theme-types.ts";

export interface SettingsSheetProps {
  /** Heading at the top of the sheet/dialog. Default "Settings". */
  readonly title?: string;
  /** Settings rows — e.g. a {@link ThemeModeControl}. */
  readonly children: ReactNode;
  /** Widen the desktop/tablet dialog for content-rich settings (see
   *  {@link BottomSheet}'s `wide`). No effect on the mobile sheet. */
  readonly wide?: boolean;
}

/**
 * The gear + responsive settings surface. Drop it into a top-bar `actions` slot
 * (or any chrome); it owns its own open/close state.
 */
export function SettingsSheet({ title = "Settings", children, wide = false }: SettingsSheetProps): ReactNode {
  const [open, setOpen] = useState(false);
  const close = (): void => {
    setOpen(false);
  };

  return (
    <>
      <Tooltip title="Settings">
        {/* ≥40px target on touch, compact on desktop. */}
        <IconButton
          aria-label="settings"
          onClick={() => setOpen(true)}
          size="small"
          sx={{ width: { xs: 40, lg: 36 }, height: { xs: 40, lg: 36 } }}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {
        /* The shared BottomSheet owns the responsive surface (drag-resizable sheet
          on mobile, dialog on desktop) + safe-area padding; we just hand it the
          settings rows. */
      }
      <BottomSheet open={open} onClose={close} title={title} wide={wide}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</Box>
      </BottomSheet>
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
