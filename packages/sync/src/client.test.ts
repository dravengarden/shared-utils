// VFC-2 — optimistic apply is instant; a patch rebases pending on top of the new
// base; a confirmed mutation drops from pending exactly once (no double-apply).

import { assertEquals } from "jsr:@std/assert";
import { createClient, type Mutators, snapshotPatch, type SyncState } from "../mod.ts";

interface S {
  readonly n: number;
}
const muts = {
  add: (s: S, a: { d: number }): S => ({ n: s.n + a.d }),
} satisfies Mutators<S>;
const initial: SyncState<S> = { version: 0, value: { n: 0 } };

Deno.test("optimistic apply is instant", () => {
  const c = createClient<S, typeof muts>({ clientId: "c", mutators: muts, initial });
  const m = c.mutate("add", { d: 5 });
  assertEquals(c.view(), { n: 5 });
  assertEquals(c.pending().length, 1);
  assertEquals(m.name, "add");
});

Deno.test("rebase: pending replays on a patch confirming ANOTHER mutation", () => {
  const c = createClient<S, typeof muts>({ clientId: "c", mutators: muts, initial });
  c.mutate("add", { d: 5 }); // pending A → view 5
  // another client's +10 lands first: absolute base {n:10}, confirms "other"
  c.applyPatch(snapshotPatch(1, { n: 10 }, ["other"]));
  assertEquals(c.view(), { n: 15 }); // base 10 + replayed A(+5)
  assertEquals(c.pending().length, 1); // A still unconfirmed
});

Deno.test("confirmed pending drops once; duplicate patch is a no-op", () => {
  const c = createClient<S, typeof muts>({ clientId: "c", mutators: muts, initial, newId: (): string => "A" });
  c.mutate("add", { d: 5 });
  c.applyPatch(snapshotPatch(1, { n: 5 }, ["A"])); // arbiter applied A
  assertEquals(c.view(), { n: 5 });
  assertEquals(c.pending().length, 0); // dropped, not replayed on top
  c.applyPatch(snapshotPatch(1, { n: 5 }, ["A"])); // duplicate delivery
  assertEquals(c.view(), { n: 5 }); // no double-apply (version not newer)
});
