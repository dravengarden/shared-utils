// Wire + core contracts for the local-first sync engine. This is the
// cross-language source of truth: a Rust arbiter (e.g. cowboy's daemon) mirrors
// `Mutation` / `Patch` as serde structs; the TS client + reference arbiter below
// honor the same shapes. Keep every field JSON-plain.

/** Monotonic version assigned by the arbiter — the source-of-truth's clock. */
export type Version = number;

/** Stable id of a terminal/client (mutation namespacing + ack routing). */
export type ClientId = string;

/** Globally-unique id a client mints per mutation: the reconcile + dedupe key.
 *  The same id is reused on retry so the arbiter's dedupe makes retry idempotent. */
export type MutationId = string;

/** A named, deterministic intent to change the value. `args` MUST be JSON-plain. */
export interface Mutation<Args = unknown> {
  readonly id: MutationId;
  readonly client: ClientId;
  readonly name: string;
  readonly args: Args;
}

/** The authoritative value at a version (what the arbiter holds / a client's
 *  confirmed base). */
export interface SyncState<T> {
  readonly version: Version;
  readonly value: T;
}

/** An arbiter→client update. The mutator/rebase core depends ONLY on this
 *  interface, so a future prolly-tree / Merkle diff can implement it without
 *  touching any caller (REQ-3).
 *
 *  - `apply(prev)` produces the new authoritative value. A SNAPSHOT patch ignores
 *    `prev` and returns the absolute value; an OP patch would fold ops into
 *    `prev`. v1 ships snapshot patches (absolute), which makes reorder/dup/drop
 *    trivially convergent — the client just keeps the newest `toVersion`.
 *  - `confirmed` lists the mutation ids now folded into the truth → the client
 *    drops them from its pending queue. */
export interface Patch<T> {
  readonly fromVersion: Version;
  readonly toVersion: Version;
  readonly confirmed: readonly MutationId[];
  apply(prev: T): T;
}
