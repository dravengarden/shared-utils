// Step 7 — end-to-end smoke: one arbiter + one client, mutate → receive →
// applyPatch, views agree and pending clears.

import { assertEquals, assertExists } from "jsr:@std/assert";
import { createArbiter, createClient, type Mutators } from "./mod.ts";

interface S {
  readonly n: number;
}
const muts = {
  add: (s: S, a: { d: number }): S => ({ n: s.n + a.d }),
} satisfies Mutators<S>;

Deno.test("smoke: arbiter + client round-trip", () => {
  const arbiter = createArbiter<S>({ mutators: muts, initial: { n: 0 } });
  const c = createClient<S, typeof muts>({
    clientId: "c",
    mutators: muts,
    initial: arbiter.current(),
    newId: (): string => "m1",
  });

  const m = c.mutate("add", { d: 7 });
  assertEquals(c.view(), { n: 7 }); // optimistic, instant

  const patch = arbiter.receive(m);
  assertExists(patch);
  c.applyPatch(patch);

  assertEquals(c.view(), { n: 7 });
  assertEquals(c.pending().length, 0);
  assertEquals(arbiter.current().value, { n: 7 });

  // duplicate receive is idempotent (returns null)
  assertEquals(arbiter.receive(m), null);
});
