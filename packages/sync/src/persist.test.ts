// Persistence seam (`onCommit`) + restart convergence. Demonstrates the
// service-side durability story WITHOUT baking a backend into the core: the app
// persists each CommitRecord (here into a plain object standing in for pg), and
// on "restart" resumes the arbiter from the last snapshot at its persisted
// version — so a client that cached the pre-restart version still converges and
// the version clock stays monotonic.

import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  type ClientSnapshot,
  type CommitRecord,
  createArbiter,
  createClient,
  hashValue,
  type LocalPersistence,
  type Mutators,
} from "../mod.ts";

interface Doc {
  readonly title: string;
  readonly n: number;
}
const mutators = {
  rename: (d: Doc, a: { title: string }): Doc => ({ ...d, title: a.title }),
  bump: (d: Doc, a: { by: number }): Doc => ({ ...d, n: d.n + a.by }),
} satisfies Mutators<Doc>;

interface Store {
  version: number;
  value: Doc;
  valueHash: string;
}

Deno.test("onCommit persists; arbiter resumes from snapshot at its version", () => {
  const store: Store = { version: 0, value: { title: "", n: 0 }, valueHash: hashValue({ title: "", n: 0 }) };
  const persist = (r: CommitRecord<Doc>): void => {
    store.version = r.version;
    store.value = r.value;
    store.valueHash = r.valueHash;
  };

  // --- first arbiter lifetime ---
  const a1 = createArbiter<Doc>({ mutators, initial: store.value, onCommit: persist });
  const c1 = createClient<Doc, typeof mutators>({
    clientId: "c1",
    mutators,
    initial: a1.current(),
  });
  c1.applyPatch(a1.receive(c1.mutate("rename", { title: "Hello" })) ?? unreachable());
  c1.applyPatch(a1.receive(c1.mutate("bump", { by: 3 })) ?? unreachable());

  assertEquals(store.version, 2);
  assertEquals(store.value, { title: "Hello", n: 3 });
  assertEquals(hashValue(store.value), store.valueHash); // integrity of the persisted snapshot
  assertEquals(c1.view(), { title: "Hello", n: 3 });
  assertEquals(c1.pending().length, 0);

  // --- restart: a2 resumes from the persisted snapshot AT its version ---
  const a2 = createArbiter<Doc>({
    mutators,
    initial: store.value,
    initialVersion: store.version,
    onCommit: persist,
  });
  assertEquals(a2.current().version, 2); // clock did NOT reset to 0

  // A client that cached the pre-restart state (version 2) reconnects: the
  // resync is at version 2, so it neither rejects nor double-applies; a new
  // mutation advances monotonically and converges.
  const c2 = createClient<Doc, typeof mutators>({
    clientId: "c2",
    mutators,
    initial: a2.current(),
    onDiverge: (d): never => {
      throw new Error(`diverge v${String(d.version)}`);
    },
  });
  c2.applyPatch(a2.resync()); // reconnect heal
  assertEquals(c2.view(), { title: "Hello", n: 3 });

  c2.applyPatch(a2.receive(c2.mutate("rename", { title: "World" })) ?? unreachable());
  assertEquals(a2.current().version, 3); // monotonic across the restart boundary
  assertEquals(c2.view(), { title: "World", n: 3 });
  assertEquals(store.version, 3);
});

Deno.test("onDiverge fires when a patch's valueHash disagrees with the value", () => {
  let fired: { expected: string; got: string } | null = null;
  const c = createClient<Doc, typeof mutators>({
    clientId: "c",
    mutators,
    initial: { version: 0, value: { title: "", n: 0 } },
    onDiverge: (d): void => {
      fired = { expected: d.expected, got: d.got };
    },
  });
  // A hand-forged patch whose value and valueHash disagree (corrupt round-trip).
  c.applyPatch({
    fromVersion: 0,
    toVersion: 1,
    confirmed: [],
    valueHash: "deadbeef",
    apply: (): Doc => ({ title: "x", n: 1 }),
  });
  assertEquals(fired !== null, true);
});

Deno.test("LocalPersistence: flush saves {base, pending}; hydrate restores them", async () => {
  let stored: ClientSnapshot<Doc> | null = null;
  const local: LocalPersistence<ClientSnapshot<Doc>> = {
    load: (): Promise<ClientSnapshot<Doc> | null> => Promise.resolve(stored),
    save: (s): Promise<void> => {
      stored = s;
      return Promise.resolve();
    },
  };
  const initial = { version: 3, value: { title: "Hi", n: 1 } };
  const c1 = createClient<Doc, typeof mutators>({ clientId: "c", mutators, initial, local });
  c1.mutate("bump", { by: 4 }); // pending → view n:5
  await c1.flush();
  assertExists(stored);

  // Reload: a fresh client hydrates base + pending from the durable outbox.
  const c2 = createClient<Doc, typeof mutators>({
    clientId: "c",
    mutators,
    initial: { version: 0, value: { title: "", n: 0 } },
    local,
  });
  await c2.hydrate();
  assertEquals(c2.version(), 3);
  assertEquals(c2.view(), { title: "Hi", n: 5 }); // restored base + replayed pending
  assertEquals(c2.pending().length, 1); // the optimistic bump survived the reload
});

function unreachable(): never {
  throw new Error("arbiter returned null for a fresh mutation");
}
