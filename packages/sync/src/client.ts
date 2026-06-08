// Client engine: optimistic local apply + rebase-on-patch (the Replicache model,
// scoped to one synced value). The view a caller renders is always
//   base (last confirmed authoritative state)  +  replay(pending mutations)
// so a local mutation shows instantly, and every arbiter patch re-derives the
// view from the new authoritative base with the still-unconfirmed mutations
// replayed on top — converging on the arbiter's order with no lost update and
// no ghost (a confirmed mutation is dropped from pending exactly once).

import { hashValue } from "./hash.ts";
import { applyMutation, type ArgsOf, type Mutators } from "./mutators.ts";
import type { ClientId, Mutation, MutationId, Patch, SyncState, Version } from "./types.ts";

/** Recursively freeze a value so a mutator that MUTATES its input (the cardinal
 *  sin — it breaks replay convergence) throws in dev instead of silently
 *  corrupting state. O(value); gate behind `freezeForDev`, off in prod. */
function deepFreeze<V>(value: V): V {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const k of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[k]);
  }
  return value;
}

export interface Client<T, M extends Mutators<T>> {
  /** The value to render: confirmed base + replayed pending. */
  view(): T;
  /** The confirmed (arbiter) version this client has applied up to. */
  version(): Version;
  /** Outstanding optimistic mutations not yet confirmed by the arbiter. */
  pending(): readonly Mutation[];
  /** Apply a mutator locally (instant) and return the Mutation to send to the
   *  arbiter. Re-send the SAME object on retry — its id makes the arbiter
   *  idempotent. */
  mutate<K extends keyof M & string>(name: K, args: ArgsOf<T, M, K>): Mutation<ArgsOf<T, M, K>>;
  /** Fold an arbiter patch into the base, drop confirmed pending, rebase the
   *  rest. Stale/duplicate patches are a no-op. */
  applyPatch(patch: Patch<T>): void;
}

export interface ClientOpts<T, M extends Mutators<T>> {
  clientId: ClientId;
  mutators: M;
  /** The arbiter's current state at connect (version 0 + initial value, or a
   *  resync snapshot). */
  initial: SyncState<T>;
  onChange?: (view: T) => void;
  /** Mutation-id factory (default `clientId:counter`). Inject for deterministic
   *  tests. Must be globally unique across clients. */
  newId?: () => MutationId;
  /** Called when an applied patch's `valueHash` disagrees with this client's own
   *  value at that version (no pending) — i.e. a divergence/integrity failure
   *  (corrupt wire round-trip, non-deterministic mutator, …). Default:
   *  `console.error`. Throw here to fail loud in tests. */
  onDiverge?: (detail: { version: Version; expected: string; got: string }) => void;
  /** Dev-only: deep-freeze the confirmed base so a mutator that mutates its
   *  input throws. O(value) per patch; leave off in production. */
  freezeForDev?: boolean;
}

export function createClient<T, M extends Mutators<T>>(opts: ClientOpts<T, M>): Client<T, M> {
  const { clientId, mutators, onChange, freezeForDev } = opts;
  const onDiverge = opts.onDiverge ??
    ((d: { version: Version; expected: string; got: string }): void => {
      console.error(`sync: divergence at v${String(d.version)}: expected ${d.expected}, got ${d.got}`);
    });
  let seq = 0;
  const newId = opts.newId ?? ((): MutationId => `${clientId}:${String(++seq)}`);

  const freeze = (s: SyncState<T>): SyncState<T> =>
    freezeForDev ? { version: s.version, value: deepFreeze(s.value) } : s;

  let base: SyncState<T> = freeze(opts.initial);
  let queue: Mutation[] = [];
  let viewValue: T = base.value;

  const recompute = (): void => {
    let v = base.value;
    for (const m of queue) {
      v = applyMutation(mutators, v, m);
    }
    viewValue = v;
  };

  return {
    view: (): T => viewValue,
    version: (): Version => base.version,
    pending: (): readonly Mutation[] => queue,

    mutate<K extends keyof M & string>(name: K, args: ArgsOf<T, M, K>): Mutation<ArgsOf<T, M, K>> {
      const m: Mutation<ArgsOf<T, M, K>> = { id: newId(), client: clientId, name, args };
      queue.push(m);
      // Incremental: apply on the current view (== replaying just this one on top
      // of the already-replayed queue), equivalent to a full recompute.
      viewValue = applyMutation(mutators, viewValue, m);
      onChange?.(viewValue);
      return m;
    },

    applyPatch(patch: Patch<T>): void {
      let changed = false;
      // CONFIRMATIONS ARE MONOTONIC FACTS — process them from EVERY patch, even a
      // reordered/older/dup one. A patch's value may be stale (an absolute
      // snapshot we already advanced past), but its `confirmed` still tells us a
      // pending mutation is now folded into the truth. Skipping it would leave
      // that mutation in `queue` and replay it on top of a newer base that
      // already includes it → double-count → divergence (caught by the fuzz).
      if (patch.confirmed.length > 0) {
        const confirmed = new Set<MutationId>(patch.confirmed);
        const next = queue.filter((m) => !confirmed.has(m.id));
        if (next.length !== queue.length) {
          queue = next;
          changed = true;
        }
      }
      // VALUE: only a strictly-newer absolute snapshot advances the base; an
      // older/duplicate snapshot's value is ignored (idempotent). (An op-patch
      // would additionally require fromVersion === base.version + gap → resync.)
      if (patch.toVersion > base.version) {
        base = freeze({ version: patch.toVersion, value: patch.apply(base.value) });
        changed = true;
      }
      // Machine-checked convergence: once we're AT this patch's version with NO
      // pending, our base IS the authoritative value, so its hash must match the
      // patch's. A mismatch means a corrupt round-trip or a non-deterministic
      // mutator — surface it loudly rather than silently diverge.
      if (
        patch.valueHash !== undefined &&
        queue.length === 0 &&
        base.version === patch.toVersion
      ) {
        const got = hashValue(base.value);
        if (got !== patch.valueHash) {
          onDiverge({ version: patch.toVersion, expected: patch.valueHash, got });
        }
      }
      if (changed) {
        recompute();
        onChange?.(viewValue);
      }
    },
  };
}
