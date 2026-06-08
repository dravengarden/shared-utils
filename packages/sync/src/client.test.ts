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

Deno.test("mutate accepts an explicit id (= cmid) so confirm-by-cmid drops it", () => {
  const c = createClient<S, typeof muts>({ clientId: "c", mutators: muts, initial });
  const m = c.mutate("add", { d: 1 }, "cmid-X");
  assertEquals(m.id, "cmid-X");
  c.confirm(["cmid-X"]); // the same key landing elsewhere drops exactly this row
  assertEquals(c.pending().length, 0);
});

Deno.test("applyPatch force: resync adopts a lower-version snapshot + replays pending", () => {
  const c = createClient<S, typeof muts>({ clientId: "c", mutators: muts, initial: { version: 5, value: { n: 100 } } });
  c.mutate("add", { d: 7 }); // pending → view 107
  // service restarted: its version clock reset; the resync snapshot is truth.
  c.applyPatch(snapshotPatch(1, { n: 50 }, []), { force: true });
  assertEquals(c.version(), 1); // adopted despite 1 < 5
  assertEquals(c.view(), { n: 57 }); // base 50 + replayed pending(+7)
  c.applyPatch(snapshotPatch(0, { n: 999 }, [])); // non-force stale → still ignored
  assertEquals(c.view(), { n: 57 });
});

Deno.test("bump: re-anchors a pending mutation to the tail (retry-to-end)", () => {
  type L = readonly string[];
  const lm = { push: (l: L, a: { v: string }): L => [...l, a.v] } satisfies Mutators<L>;
  const c = createClient<L, typeof lm>({ clientId: "c", mutators: lm, initial: { version: 0, value: [] } });
  const a = c.mutate("push", { v: "A" });
  c.mutate("push", { v: "B" });
  assertEquals(c.view(), ["A", "B"]);
  c.bump(a.id); // retry A → re-anchored after everything
  assertEquals(c.view(), ["B", "A"]);
  assertEquals(c.pending().length, 2); // same id, still one pending each (no dup)
  c.bump(a.id); // already last → no-op
  assertEquals(c.view(), ["B", "A"]);
  c.bump("nope"); // unknown id → no-op
  assertEquals(c.view(), ["B", "A"]);
});

Deno.test("confirm: out-of-band ack drops pending, no base change, idempotent", () => {
  const c = createClient<S, typeof muts>({ clientId: "c", mutators: muts, initial });
  const a = c.mutate("add", { d: 5 }); // pending A → view 5
  c.mutate("add", { d: 3 }); // pending B → view 8
  assertEquals(c.view(), { n: 8 });
  assertEquals(c.version(), 0);
  c.confirm([a.id]); // A acked by a SEPARATE signal (not this state's patch)
  assertEquals(c.pending().length, 1); // only B left
  assertEquals(c.view(), { n: 3 }); // base 0 + replayed B(+3); A not double-counted
  assertEquals(c.version(), 0); // no base/version change
  c.confirm([a.id]); // not pending anymore → no-op
  assertEquals(c.pending().length, 1);
  // A later confirmed by a real patch too: already gone, value just advances.
  c.applyPatch(snapshotPatch(1, { n: 5 }, [a.id]));
  assertEquals(c.view(), { n: 8 }); // base {n:5} (incl A) + replayed B(+3)
});
