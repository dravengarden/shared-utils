// Public surface of @shared-utils/native-media — the web half of a native iOS
// media-control bridge (lock screen / AirPods / CarPlay / Control Center over
// MPRemoteCommandCenter + MPNowPlayingInfoCenter + AVAudioSession). Feature-detected
// and PWA-safe: every call no-ops outside the native iOS shell. See ./native-media.ts
// for the why, and ./ios/ for the Swift native half an app's iOS shell compiles in.
export {
  nativeMediaAvailable,
  nativeMediaClear,
  type NativeMediaCommand,
  nativeMediaSetNowPlaying,
  nativeMediaSetState,
  type NativeMediaState,
  type NativeNowPlaying,
  onNativeMediaCommand,
} from "./native-media.ts";
