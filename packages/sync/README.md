# @shared-utils/sync

A small, pure-TS local-first state-sync engine: instant optimistic UI on every
client, a central arbiter as the single source of truth, and provable
convergence under reorder / duplication / loss.

It is the **central-authority optimistic-replication** model (Replicache /
Rocicorp Zero, Figma server-ordered LWW) — **not** a P2P CRDT (Automerge / Yjs /
Loro). The arbiter linearizes; clients rebase. That fit was chosen deliberately:
the apps here already have an authoritative service, so we want server order, not
leaderless merge.

## Model

```
        mutate(name,args)              receive(m) → Patch
client ───────────────────▶ arbiter ───────────────────▶ all clients
  │  optimistic: view = base + replay(pending)   │  applyPatch: fold + rebase
  └──────────────── the SAME Mutation is retried on failure (id ⇒ idempotent)
```

- **Mutator** — a pure, deterministic `(state, args) => state`. Determinism is
  the whole game: a mutator that reads `Date.now()`/`Math.random()` or mutates
  its input breaks replay convergence.
- **Client** — applies mutators locally for instant UI, keeps them in a pending
  queue, and on each arbiter `Patch` folds the new authoritative base and
  replays the still-unconfirmed pending on top (rebase). A confirmed mutation
  drops from pending exactly once — no lost update, no ghost.
- **Arbiter** — the truth. A thin **serializer**: dedupe by `MutationId`,
  apply, `version++`, emit a `Patch`. No optimistic state, no rebase. A Rust
  service (e.g. cowboy's daemon) implements the SAME contract natively against
  the `Mutation` / `Patch` JSON wire shape.
- **Patch** — the diff between versions. v1 is an absolute `snapshotPatch`
  (carries the whole value → reorder/dup/drop converge trivially; O(state) on
  the wire, fine while synced states are small). The `Patch` interface is the
  seam where a Merkle-DAG / prolly-tree op-patch can later slot in without
  touching the client/arbiter cores.

## Correctness

`src/converge.test.ts` is the gate: a 1-arbiter / N-client fuzz where the
broadcast channel reorders, duplicates, and (in the lossy variant) drops
patches. After quiescence every client must equal the arbiter with zero pending
— 600 seeded episodes. The non-obvious invariant it enforces: **confirmations
are monotonic facts**, processed from *every* patch (even a stale/dup one),
while only a strictly-newer snapshot advances the value. Skipping an older
patch's `confirmed` would strand a pending mutation and replay it on top of a
base that already includes it → divergence.

## Usage

```ts
import { createArbiter, createClient, type Mutators } from "@shared-utils/sync";

interface Doc {
  readonly title: string;
}
const mutators = {
  rename: (d: Doc, a: { title: string }): Doc => ({ ...d, title: a.title }),
} satisfies Mutators<Doc>;

// service side
const arbiter = createArbiter<Doc>({ mutators, initial: { title: "" } });

// client side
const client = createClient<Doc, typeof mutators>({
  clientId: "tab-1",
  mutators,
  initial: arbiter.current(),
  onChange: (view) => render(view),
});

const m = client.mutate("rename", { title: "Hello" }); // instant local view
const patch = arbiter.receive(m); // send m over the wire; arbiter returns a patch
if (patch) client.applyPatch(patch); // broadcast to every client; each folds it

// on (re)connect, heal from any version:
client.applyPatch(arbiter.resync());
```

## Status

v0.0.1 — protocol types, client engine, snapshot patch, reference arbiter, and
the convergence fuzz. Op-patches (Merkle-DAG) are deferred behind `Patch`.
First consumer: cowboy (`state-sync-engine` task).
