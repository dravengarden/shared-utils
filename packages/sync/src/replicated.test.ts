// replicatedStore — the op-based tier's reactive-store face: instant mutate +
// upstream send, patch fold, resend-on-reconnect, durable-outbox hydrate, and the
// ReadableStore (get/subscribe) face that drives useStore.

import { assertEquals } from "jsr:@std/assert";
import {
  type ClientSnapshot,
  type LocalPersistence,
  type Mutation,
  type Mutators,
  replicatedStore,
  snapshotPatch,
} from "../mod.ts";

interface S {
  readonly n: number;
}
const muts = {
  add: (s: S, a: { d: number }): S => ({ n: s.n + a.d }),
} satisfies Mutators<S>;

Deno.test("replicated: mutate is instant + sends upstream", () => {
  const sent: Mutation[] = [];
  const s = replicatedStore<S, typeof muts>({
    clientId: "c",
    mutators: muts,
    initial: { n: 0 },
    send: (m): void => {
      sent.push(m);
    },
  });
  s.mutate("add", { d: 5 });
  assertEquals(s.get(), { n: 5 });
  assertEquals(s.pending().length, 1);
  assertEquals(sent.length, 1);
});

Deno.test("replicated: patch confirms pending + advances base", () => {
  const sent: Mutation[] = [];
  const s = replicatedStore<S, typeof muts>({
    clientId: "c",
    mutators: muts,
    initial: { n: 0 },
    send: (m): void => {
      sent.push(m);
    },
  });
  const m = s.mutate("add", { d: 5 });
  s.applyPatch(snapshotPatch(1, { n: 5 }, [m.id]));
  assertEquals(s.get(), { n: 5 });
  assertEquals(s.pending().length, 0);
  assertEquals(s.version(), 1);
});

Deno.test("replicated: resend re-sends every pending mutation", () => {
  const sent: Mutation[] = [];
  const s = replicatedStore<S, typeof muts>({
    clientId: "c",
    mutators: muts,
    initial: { n: 0 },
    send: (m): void => {
      sent.push(m);
    },
  });
  s.mutate("add", { d: 1 });
  s.mutate("add", { d: 2 });
  sent.length = 0;
  s.resend();
  assertEquals(sent.length, 2);
});

Deno.test("replicated: get/subscribe + onChange fire on change; unsubscribe stops", () => {
  const sent: Mutation[] = [];
  let changes = 0;
  let notifies = 0;
  const s = replicatedStore<S, typeof muts>({
    clientId: "c",
    mutators: muts,
    initial: { n: 0 },
    send: (m): void => {
      sent.push(m);
    },
    onChange: (): void => {
      changes += 1;
    },
  });
  const un = s.subscribe(() => {
    notifies += 1;
  });
  s.mutate("add", { d: 1 });
  assertEquals(notifies, 1);
  assertEquals(changes, 1);
  un();
  s.mutate("add", { d: 1 });
  assertEquals(notifies, 1);
});

Deno.test("replicated: hydrate restores the durable outbox; resend replays it", async () => {
  const sent: Mutation[] = [];
  const snap: ClientSnapshot<S> = {
    base: { version: 3, value: { n: 30 } },
    pending: [{ id: "x", client: "c", name: "add", args: { d: 5 } }],
  };
  const local: LocalPersistence<ClientSnapshot<S>> = {
    load: (): Promise<ClientSnapshot<S>> => Promise.resolve(snap),
    save: (): Promise<void> => Promise.resolve(),
  };
  const s = replicatedStore<S, typeof muts>({
    clientId: "c",
    mutators: muts,
    initial: { n: 0 },
    send: (m): void => {
      sent.push(m);
    },
    local,
  });
  await s.hydrate();
  assertEquals(s.get(), { n: 35 });
  assertEquals(s.version(), 3);
  assertEquals(s.pending().length, 1);
  s.resend();
  assertEquals(sent.length, 1);
});

Deno.test("replicated: bump moves a pending mutation to the tail", () => {
  const sent: Mutation[] = [];
  const s = replicatedStore<S, typeof muts>({
    clientId: "c",
    mutators: muts,
    initial: { n: 0 },
    send: (m): void => {
      sent.push(m);
    },
  });
  const a = s.mutate("add", { d: 1 });
  s.mutate("add", { d: 2 });
  s.bump(a.id);
  assertEquals(s.pending().at(-1)?.id, a.id);
});
