// mirroredStore — the state-based tier: pull+reconcile on connect, paced remote
// push, local mirror hydrate, live remote re-reconcile.

import { assertEquals } from "jsr:@std/assert";
import { delay } from "jsr:@std/async/delay";
import { type LocalPersistence, mirroredStore, type RemoteBackend } from "../mod.ts";

interface Pos {
  readonly chapter: string;
  readonly t: number;
}

interface FakeRemote<T> extends RemoteBackend<T> {
  saved: T[];
  emit(v: T): void;
}
function fakeRemote<T>(initial: T | null): FakeRemote<T> {
  let stored = initial;
  let sub: ((v: T) => void) | undefined = undefined;
  const saved: T[] = [];
  return {
    saved,
    load: (): Promise<T | null> => Promise.resolve(stored),
    save: (v: T): Promise<void> => {
      stored = v;
      saved.push(v);
      return Promise.resolve();
    },
    subscribe: (onRemote): () => void => {
      sub = onRemote;
      return (): void => {
        sub = undefined;
      };
    },
    emit: (v: T): void => {
      stored = v;
      sub?.(v);
    },
  };
}

function memLocal<T>(initial: T | null): LocalPersistence<T> {
  let v = initial;
  return {
    load: (): Promise<T | null> => Promise.resolve(v),
    save: (next: T): Promise<void> => {
      v = next;
      return Promise.resolve();
    },
  };
}

Deno.test("mirrored: connect pulls remote (remote-wins default)", async () => {
  const remote = fakeRemote<number>(42);
  const s = mirroredStore<number>({ initial: 0, remote });
  assertEquals(s.get(), 0);
  s.connect();
  await delay(0);
  assertEquals(s.get(), 42);
  assertEquals(s.status, "live");
});

Deno.test("mirrored: custom reconcile keeps local when remote not ahead", async () => {
  const remote = fakeRemote<Pos>({ chapter: "ch1", t: 3 });
  const s = mirroredStore<Pos>({
    initial: { chapter: "ch1", t: 10 },
    remote,
    reconcile: (l, r): Pos => (r.chapter === l.chapter && r.t > l.t + 8 ? r : l),
  });
  s.connect();
  await delay(0);
  assertEquals(s.get(), { chapter: "ch1", t: 10 });
});

Deno.test("mirrored: custom reconcile adopts remote when far ahead", async () => {
  const remote = fakeRemote<Pos>({ chapter: "ch1", t: 100 });
  const s = mirroredStore<Pos>({
    initial: { chapter: "ch1", t: 10 },
    remote,
    reconcile: (l, r): Pos => (r.chapter === l.chapter && r.t > l.t + 8 ? r : l),
  });
  s.connect();
  await delay(0);
  assertEquals(s.get().t, 100);
});

Deno.test("mirrored: set updates value, notifies, pushes remote immediately", async () => {
  const remote = fakeRemote<number>(null);
  const s = mirroredStore<number>({ initial: 0, remote });
  let hits = 0;
  s.subscribe(() => {
    hits += 1;
  });
  s.set(5);
  assertEquals(s.get(), 5);
  assertEquals(hits, 1);
  await delay(0);
  assertEquals(remote.saved, [5]);
});

Deno.test("mirrored: debounced push coalesces; flush forces the latest", async () => {
  const remote = fakeRemote<number>(null);
  const s = mirroredStore<number>({ initial: 0, remote, push: { debounceMs: 1000 } });
  s.set(1);
  s.set(2);
  s.set(3);
  assertEquals(remote.saved, []);
  await s.flush();
  assertEquals(remote.saved, [3]);
});

Deno.test("mirrored: hydrate adopts the local mirror", async () => {
  const remote = fakeRemote<number>(null);
  const s = mirroredStore<number>({ initial: 0, remote, local: memLocal<number>(99) });
  await s.hydrate();
  assertEquals(s.get(), 99);
});

Deno.test("mirrored: live remote update re-reconciles", async () => {
  const remote = fakeRemote<number>(1);
  const s = mirroredStore<number>({ initial: 0, remote });
  s.connect();
  await delay(0);
  assertEquals(s.get(), 1);
  remote.emit(7);
  assertEquals(s.get(), 7);
});
