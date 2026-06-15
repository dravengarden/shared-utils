// Public surface of @shared-utils/native-nav — the web half of a native iOS
// snapshot navigation bridge. Feature-detected and PWA-safe: every call is a
// graceful no-op outside the native iOS shell. See ./native-nav.ts for the why,
// and ./ios/ for the Swift native half an app's iOS Tauri shell compiles in.
export { nativeNavAvailable, nativeNavPop, nativeNavPush, nativeNavReady, onNativeBack } from "./native-nav.ts";
