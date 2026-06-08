import { assertEquals, assertStrictEquals } from "jsr:@std/assert";
import { type KvStorage, persisted } from "../mod.ts";

function memStorage(): KvStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k): string | null => map.get(k) ?? null,
    setItem: (k, v): void => {
      map.set(k, v);
    },
    removeItem: (k): void => {
      map.delete(k);
    },
  };
}

Deno.test("persisted: reads initial, set persists + notifies, unsubscribe stops", () => {
  const storage = memStorage();
  const s = persisted("k", 1, { storage, crossTab: false });
  assertEquals(s.get(), 1);
  let n = 0;
  const off = s.subscribe(() => {
    n++;
  });
  s.set(2);
  assertEquals(s.get(), 2);
  assertEquals(storage.map.get("k"), "2");
  assertEquals(n, 1);
  off();
  s.set(3);
  assertEquals(n, 1); // unsubscribed → no more notifications
});

Deno.test("persisted: get() is a STABLE reference between changes (no render loop)", () => {
  const s = persisted<{ a: number }>("k", { a: 1 }, { storage: memStorage(), crossTab: false });
  // The useSyncExternalStore invariant: getSnapshot must be stable while
  // unchanged, or React loops forever ("getSnapshot should be cached").
  assertStrictEquals(s.get(), s.get());
  s.set({ a: 2 });
  assertStrictEquals(s.get(), s.get()); // still stable after a change
});

Deno.test("persisted: setting an EQUAL value is a no-op (Object.is guard, no notify)", () => {
  const s = persisted("k", 5, { storage: memStorage(), crossTab: false });
  let n = 0;
  s.subscribe(() => {
    n++;
  });
  s.set(5); // same value
  assertEquals(n, 0); // no spurious notify ⇒ can't drive a re-render cycle
});

Deno.test("persisted: updater form + corrupt value falls back to initial (never throws)", () => {
  const storage = memStorage();
  const s = persisted("k", 10, { storage, crossTab: false });
  s.set((p) => p + 5);
  assertEquals(s.get(), 15);
  storage.map.set("k", "{not json");
  const s2 = persisted("k", 42, { storage, crossTab: false });
  assertEquals(s2.get(), 42); // corrupt → initial, no throw
});
