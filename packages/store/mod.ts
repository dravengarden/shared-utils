// @shared-utils/store — a tiny framework-agnostic reactive store.
//
// The shared `Store` / `ReadableStore` contract + `persisted()` for per-device
// prefs (localStorage-backed, cross-tab). Pair with @shared-utils/store-react's
// `useStore` to render any store; sync clients adapt to the same contract, so one
// hook covers prefs AND synced state.

export { persisted } from "./src/store.ts";
export type { KvStorage, PersistedOpts, ReadableStore, Store } from "./src/store.ts";
