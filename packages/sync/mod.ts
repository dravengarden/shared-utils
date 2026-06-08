// @shared-utils/sync — a small, pure-TS local-first state-sync engine.
//
// A central ARBITER owns the truth; clients apply deterministic MUTATORS
// locally for instant UI, send them to the arbiter, and REBASE their pending
// mutations onto each broadcast PATCH (Replicache model). Correctness lives in
// the client engine + the convergence fuzz; the arbiter is a thin serializer a
// Rust service can implement natively against the same `Mutation`/`Patch`
// contract. The Merkle-DAG "incremental diff" idea is deferred behind `Patch`.
//
// See packages/sync/README.md and the cowboy `state-sync-engine` task.

export { createClient } from "./src/client.ts";
export type { Client, ClientOpts } from "./src/client.ts";
export { createArbiter } from "./src/arbiter.ts";
export type { Arbiter, ArbiterOpts } from "./src/arbiter.ts";
export { applyMutation } from "./src/mutators.ts";
export type { ArgsOf, Mutator, Mutators } from "./src/mutators.ts";
export { snapshotPatch } from "./src/patch/snapshot.ts";
export type { ClientId, Mutation, MutationId, Patch, SyncState, Version } from "./src/types.ts";
