// Cross-platform haptic feedback — a reusable primitive, NOT tied to DetentSheet.
// Import { haptic } anywhere you want a tactile tap (button confirm, toggle, long-
// press, sheet open …). Adding a new call site is pure web — it ships with the next
// web deploy and needs NO native app reinstall, because the native shell already
// carries the generic haptics plugin.
//
// Resolution order, best → worst:
//   1. Native Tauri haptics plugin — real OS haptics (UIImpactFeedbackGenerator on
//      iOS). This is the ONLY reliable haptic on iOS: Safari/PWA has no Vibration
//      API. Works only inside a Tauri native shell that (a) registers
//      tauri-plugin-haptics and (b) grants it to this origin via a capability with
//      core:default + haptics:allow-impact-feedback. Feature-detected through the
//      injected IPC bridge — there is NO @tauri-apps import here, so a plain
//      browser / PWA is completely untouched.
//   2. navigator.vibrate — Android web.
//   3. hidden `<input type="checkbox" switch>` toggle — iOS 17.4+ Safari best-effort
//      (flaky; last resort for the PWA, created once + reused).
// Every path is wrapped; only a supported one does anything, harmless no-op else.

/** iOS UIImpactFeedbackGenerator styles (and the cross-platform intensities the
 *  native plugin maps them to). */
export type HapticStyle = "light" | "medium" | "heavy" | "soft" | "rigid";

// Tauri 2 injects this IPC bridge on the global when the web view runs inside a
// native shell. Accessed via a string key so the leading-underscore global name
// doesn't trip the dangle lint.
interface TauriInternals {
  readonly invoke?: (cmd: string, args?: unknown) => Promise<unknown>;
}
const TAURI_INTERNALS_KEY = "__TAURI_INTERNALS__";

// Returns true if we ARE in a native shell (so the caller skips the web fallback),
// even though the actual invoke is fire-and-forget async. The IIFE swallows the
// rejection that happens if the plugin/permission isn't present in the native build.
function nativeHaptic(style: HapticStyle): boolean {
  try {
    const internals = (globalThis as Record<string, unknown>)[
      TAURI_INTERNALS_KEY
    ] as TauriInternals | undefined;
    const invoke = internals?.invoke;
    if (typeof invoke !== "function") {
      return false;
    }
    void (async (): Promise<void> => {
      try {
        await invoke("plugin:haptics|impact_feedback", { style });
      } catch {
        // plugin or permission missing in the native build — silent
      }
    })();
    return true;
  } catch {
    return false;
  }
}

let hapticSwitch: HTMLLabelElement | null = null;
function webHaptic(): void {
  try {
    const nav = globalThis.navigator;
    if (typeof nav?.vibrate === "function") {
      nav.vibrate(10);
    }
  } catch {
    // unsupported — ignore
  }
  try {
    const doc = globalThis.document as Document | undefined;
    if (doc?.body === undefined || doc.body === null) {
      return;
    }
    if (hapticSwitch === null) {
      const label = doc.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.cssText =
        "position:fixed;top:0;left:0;width:0;height:0;opacity:0;pointer-events:none;overflow:hidden";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      label.append(input);
      doc.body.append(label);
      hapticSwitch = label;
    }
    hapticSwitch.querySelector("input")?.click();
  } catch {
    // unsupported — ignore
  }
}

/** Fire a haptic tap. Native OS haptic inside a Tauri shell, web fallback otherwise.
 *  Safe to call anywhere, any platform — silent no-op where unsupported. */
export function haptic(style: HapticStyle = "medium"): void {
  if (nativeHaptic(style)) {
    return;
  }
  webHaptic();
}
