# @shared-utils/native-nav

Native iOS **snapshot navigation transitions** for single-WKWebView SPA shells (Tauri), with a graceful no-op fallback
everywhere else.

## Why

Returning from a detail view to a list froze ~480ms on real iOS devices: WebKit re-composites the whole view in one
frame on the swipe-back (the main thread is idle, `mc << paint`; the compositor stalls). No web-side change fixed it
(opacity / visibility / display hide, ripple/focus cleanup, deferred reveal — all tried, all ineffective on device).

The fix is the **Hotwire-Native technique, not the framework**: wrap the web transition in a _native_ one. On a push/pop
the native shell snapshots the current web pixels, slides them with a UIKit animation (GPU-smooth), and — for the freeze
— **holds the snapshot on top until the web says the destination is painted** (`ready`). The user sees a smooth native
slide; the frozen web frame happens underneath the snapshot and is never visible.

## Two halves

| Half         | Where                             | What                                                                                                                                                                                                                             |
| ------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web          | `mod.ts` (TS)                     | Feature-detects the native bridge; `push`/`pop`/`ready`/`onNativeBack`. Every call is a **no-op returning false off the native iOS shell** — the PWA, Android, and plain browsers keep their existing web navigation, untouched. |
| Native (iOS) | `ios/SnapshotNavController.swift` | Registers the `lvNativeNav` `WKScriptMessageHandler`, overlays transition snapshots over the webview, animates push/pop, holds-until-`ready`.                                                                                    |

Android intentionally rides the web path for now (the TS calls no-op there).

## Web usage

```ts
import { nativeNavAvailable, nativeNavPop, nativeNavPush, nativeNavReady } from "@shared-utils/native-nav";

// Entering a detail (list → detail):
function openDetail(id: string) {
  nativeNavPush(id); // native slides a snapshot; false off-shell (then just navigate)
  routeTo(id); // your normal in-app route change
  afterPaint(() => nativeNavReady()); // double-rAF after the detail paints
}

// Going back (detail → list):
function goBack() {
  nativeNavPop(); // native covers with a snapshot and HOLDS it
  routeToList(); // your route change (the list re-composite is hidden)
  afterPaint(() => nativeNavReady()); // reveal the painted list
}
```

`nativeNavReady()` MUST be called after the destination has actually painted (a double-`requestAnimationFrame` after the
state change is the reliable signal); otherwise the held snapshot is dropped by a safety timeout (~0.6s).

## iOS shell integration

The Swift source compiles into the app's iOS Tauri project (it lives in the generated `gen/apple/Sources/<app>/` tree,
alongside any other native tweaks). When the WKWebView is created, install the controller:

```swift
SnapshotNavController.install(on: webView)
```

In a Tauri shell the webview is created by wry; hook its creation the same way the app already reaches the webview (e.g.
swizzling `WKWebView.init(frame:configuration:)` at launch) and call `install(on:)` there.

## Status

- ✅ Web bridge (`mod.ts`) — feature-detected, PWA-safe, type-checked.
- ✅ iOS programmatic push/pop + snapshot-hold-until-`ready`.
- ⏳ Interactive edge-pan (drag-to-go-back, interruptible) + on-device tuning — the simulator's Mac GPU does not
  reproduce the freeze, so the fix is finished and confirmed on a real device.
