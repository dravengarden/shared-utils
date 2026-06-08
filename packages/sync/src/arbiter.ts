// Arbiter: the source of truth. Deliberately a "serializer" — it linearizes
// incoming mutations, version-stamps, and echoes a patch. No optimistic state,
// no rebase. This reference impl is for TS-backed services + the convergence
// fuzz; a Rust service (cowboy's daemon) implements the SAME contract natively
// (dedupe by MutationId, version++, emit a snapshot patch) — reusing its
// existing broadcast + cmid dedupe. That's why the heavy/correctness-critical
// engine is the CLIENT, not this.

import { applyMutation, type Mutators } from "./mutators.ts";
import { snapshotPatch } from "./patch/snapshot.ts";
import type { Mutation, MutationId, Patch, SyncState } from "./types.ts";

export interface Arbiter<T> {
  /** The authoritative state (for a new client's `initial`, or resync). */
  current(): SyncState<T>;
  /** Apply a mutation authoritatively and return the patch to broadcast, or
   *  `null` if it's a duplicate (already applied — idempotent). */
  receive(m: Mutation): Patch<T> | null;
  /** An absolute snapshot patch confirming every applied mutation — what a
   *  client gets on (re)connect to converge from any version + clear its pending.
   *  This is how a lossy broadcast recovers: a dropped patch is healed by the
   *  next resync. */
  resync(): Patch<T>;
}

export interface ArbiterOpts<T> {
  mutators: Mutators<T>;
  initial: T;
  /** Bound on remembered mutation ids for dedupe. A client never re-sends a
   *  CONFIRMED mutation (it's dropped from pending), so only in-flight duplicate
   *  *deliveries* need to be caught — a window well past the in-flight set is
   *  enough. 0 = unbounded (simplest; fine for small/short-lived states). */
  dedupeWindow?: number;
}

export function createArbiter<T>(opts: ArbiterOpts<T>): Arbiter<T> {
  const { mutators } = opts;
  const window = opts.dedupeWindow ?? 0;
  let state: SyncState<T> = { version: 0, value: opts.initial };
  // Insertion-ordered dedupe set; trimmed to `window` when bounded.
  const seen = new Set<MutationId>();

  return {
    current: (): SyncState<T> => state,

    receive(m: Mutation): Patch<T> | null {
      if (seen.has(m.id)) {
        return null; // idempotent — duplicate delivery/retry
      }
      seen.add(m.id);
      if (window > 0 && seen.size > window) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) {
          seen.delete(oldest);
        }
      }
      const value = applyMutation(mutators, state.value, m);
      state = { version: state.version + 1, value };
      return snapshotPatch(state.version, value, [m.id]);
    },

    resync: (): Patch<T> => snapshotPatch(state.version, state.value, [...seen]),
  };
}
