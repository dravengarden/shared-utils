// @shared-utils/sync-idb — IndexedDB LocalPersistence for sync clients.
//
// Inject into a @shared-utils/sync client's `local` option to cache its
// {base, pending} in the browser: instant first paint on reload + a durable
// outbox (unconfirmed optimistic mutations survive a reload and re-send).

export { idbListKeys, idbPersistence } from "./src/idb.ts";
export type { IdbOpts } from "./src/idb.ts";
