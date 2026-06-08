// @shared-utils/store-react — the React binding for @shared-utils/store.
//
// One hook, `useStore(store)`, renders any ReadableStore: a per-device
// `persisted` pref or a sync client adapted to the same contract. Keeps React
// out of the agnostic core (this package depends on it; the core does not).

export { useStore } from "./src/use-store.ts";
