// SnapshotNavController — the native (iOS) half of @shared-utils/native-nav.
//
// THE PROBLEM IT SOLVES: in a single-WKWebView SPA shell (Tauri), returning from a
// detail view to a list froze ~480ms on real iOS devices. WebKit re-composites the
// whole view in one frame on the swipe-back; the main thread is idle (mc<<paint),
// the compositor stalls. No web-side change fixed it.
//
// THE TECHNIQUE (borrowed from Hotwire Native, not the framework): wrap the web
// transition in a NATIVE one. On a push/pop we snapshot the current web pixels into
// a UIView, slide it with a UIKit animation (GPU, buttery), and — crucially for the
// freeze — HOLD the snapshot on top until the web signals the destination is
// painted (`ready`). The user sees a smooth native slide; the frozen web frame
// happens underneath the snapshot and is never visible.
//
// Single webview: there is one WKWebView showing the whole SPA, so we animate
// snapshots over it rather than pushing view controllers. The web still changes its
// own route; this layer only owns the *visual transition*.
//
// Wiring (per app, in the iOS Tauri shell): when the WKWebView is created, call
//   SnapshotNavController.install(on: webView)
// It registers itself as the "lvNativeNav" script-message handler and overlays a
// transition container on the webview's superview. The web half (native-nav.ts)
// posts { type: "push"|"pop"|"ready" }. Off the native shell there is no handler,
// so the PWA / Android / browser keep their existing web navigation untouched.
//
// STATUS: programmatic push/pop + snapshot-hold-until-ready are implemented here.
// The interactive edge-pan gesture (drag-to-go-back, interruptible) and timing
// tuning are finished + validated on a real device in M2 — the simulator's Mac GPU
// does not reproduce the freeze, so the fix can only be confirmed on device.

import UIKit
import WebKit

@MainActor
public final class SnapshotNavController: NSObject {
  /// One controller per webview, kept alive by association (see `install`).
  private static var controllers: [ObjectIdentifier: SnapshotNavController] = [:]

  private weak var webView: WKWebView?
  /// Full-screen container that hosts transition snapshots above the webview.
  private let overlay = UIView()
  /// A snapshot we are holding on top until the web reports `ready` (pop case).
  private var heldSnapshot: UIView?
  /// Set while a pop is mid-flight so a stray `ready` can complete it.
  private var pendingPop = false

  private let messageName = "lvNativeNav"

  // MARK: Install

  /// Register the bridge on a webview. Idempotent per webview.
  public static func install(on webView: WKWebView) {
    let key = ObjectIdentifier(webView)
    if controllers[key] != nil { return }
    let controller = SnapshotNavController(webView: webView)
    controllers[key] = controller
    webView.configuration.userContentController.add(controller, name: controller.messageName)
  }

  private init(webView: WKWebView) {
    self.webView = webView
    super.init()
    overlay.isUserInteractionEnabled = false
    overlay.translatesAutoresizingMaskIntoConstraints = false
  }

  // MARK: Overlay lifecycle

  /// Attach the overlay to the webview's superview, matching the webview's frame.
  private func ensureOverlay() {
    guard let webView, let host = webView.superview, overlay.superview !== host else { return }
    overlay.removeFromSuperview()
    host.addSubview(overlay)
    NSLayoutConstraint.activate([
      overlay.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
      overlay.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
      overlay.topAnchor.constraint(equalTo: webView.topAnchor),
      overlay.bottomAnchor.constraint(equalTo: webView.bottomAnchor),
    ])
  }

  private func snapshotOfWeb() -> UIView? {
    // afterScreenUpdates:false — capture the CURRENT pixels synchronously and
    // cheaply (we want the frame as it is right now, before the route change).
    webView?.snapshotView(afterScreenUpdates: false)
  }

  // MARK: Transitions

  /// PUSH (list → detail): snapshot the current (list) view, let it sit behind a
  /// dim while the webview (now rendering the detail) slides in from the trailing
  /// edge. No hold needed — entering a detail did not freeze.
  private func handlePush() {
    guard let webView else { return }
    ensureOverlay()
    let width = overlay.bounds.width
    guard width > 0, let outgoing = snapshotOfWeb() else { return }

    overlay.isUserInteractionEnabled = true
    outgoing.frame = overlay.bounds
    overlay.addSubview(outgoing)

    // The webview underneath has (or is about to have) the detail content; slide it
    // in from the right while the list snapshot eases left + dims.
    webView.transform = CGAffineTransform(translationX: width, y: 0)
    let dim = UIView(frame: overlay.bounds)
    dim.backgroundColor = UIColor.black.withAlphaComponent(0)
    overlay.insertSubview(dim, aboveSubview: outgoing)

    let animator = UIViewPropertyAnimator(duration: 0.34, dampingRatio: 1) {
      webView.transform = .identity
      outgoing.transform = CGAffineTransform(translationX: -width * 0.3, y: 0)
      dim.backgroundColor = UIColor.black.withAlphaComponent(0.12)
    }
    animator.addCompletion { [weak self] _ in
      outgoing.removeFromSuperview()
      dim.removeFromSuperview()
      self?.overlay.isUserInteractionEnabled = false
    }
    animator.startAnimation()
  }

  /// POP (detail → list): snapshot the current (detail) view and KEEP it covering
  /// the screen. Tell nothing here — the web changes its route to the list and,
  /// once painted, posts `ready`; only THEN do we slide the held detail snapshot
  /// off to reveal the freshly-painted list. The ~480ms list re-composite happens
  /// underneath the snapshot, invisibly.
  private func handlePop() {
    ensureOverlay()
    guard overlay.bounds.width > 0, let cover = snapshotOfWeb() else { return }
    overlay.isUserInteractionEnabled = true
    cover.frame = overlay.bounds
    overlay.addSubview(cover)
    heldSnapshot = cover
    pendingPop = true
    // Safety: if `ready` never arrives (web error), reveal anyway after a beat so
    // we never strand the user behind a frozen snapshot.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
      guard let self, self.pendingPop else { return }
      self.completePop()
    }
  }

  /// Web finished painting the destination — finish whatever is held.
  private func handleReady() {
    guard pendingPop else { return }
    completePop()
  }

  private func completePop() {
    pendingPop = false
    guard let cover = heldSnapshot else { return }
    heldSnapshot = nil
    let width = overlay.bounds.width
    let animator = UIViewPropertyAnimator(duration: 0.32, dampingRatio: 1) {
      cover.transform = CGAffineTransform(translationX: width, y: 0)
    }
    animator.addCompletion { [weak self] _ in
      cover.removeFromSuperview()
      self?.overlay.isUserInteractionEnabled = false
    }
    animator.startAnimation()
  }
}

// MARK: - WKScriptMessageHandler

extension SnapshotNavController: WKScriptMessageHandler {
  public nonisolated func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard let body = message.body as? [String: Any],
          let type = body["type"] as? String else { return }
    Task { @MainActor [weak self] in
      guard let self else { return }
      switch type {
      case "push": self.handlePush()
      case "pop": self.handlePop()
      case "ready": self.handleReady()
      default: break
      }
    }
  }
}
