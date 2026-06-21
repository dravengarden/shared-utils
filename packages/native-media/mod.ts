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

// The heavier native-AVPlayer engine (decodes natively; the web is a thin
// remote) — for bulletproof background/lock-screen/AirPods where the web
// `<audio>` can't hold the session. See ./native-audio.ts + ./ios/NativeAudioController.swift.
export {
  type NativeAudioEvent,
  nativeAudioAvailable,
  nativeAudioLoad,
  nativeAudioPause,
  nativeAudioPlay,
  nativeAudioPrefetch,
  nativeAudioSeek,
  nativeAudioSetRate,
  nativeAudioStop,
  type NativeAudioTrack,
  onNativeAudioEvent,
} from "./native-audio.ts";
