// VFC-1 — convergence fuzz. The correctness gate. A 1-arbiter / N-client system
// driven by many random mutations, with the arbiter→client patch channel
// reordering, duplicating, and (in the lossy variant) dropping messages. After
// quiescence every client must equal the arbiter, with no pending mutation left
// and no double-apply.
//
// The mulberry32 PRNG below relies on `>>> 0` for uint32 wraparound; the
// prefer-math-trunc rule's suggested `Math.trunc` has different semantics and
// would corrupt the generator, so that one rule is disabled for this file.
// oxlint-disable prefer-math-trunc

import { assertEquals } from "jsr:@std/assert";
import { createArbiter, createClient, type Mutation, type Mutators, type Patch } from "../mod.ts";

type State = Readonly<Record<string, number>>;

const mutators = {
  inc: (s: State, a: { k: string; by: number }): State => ({ ...s, [a.k]: (s[a.k] ?? 0) + a.by }),
  set: (s: State, a: { k: string; v: number }): State => ({ ...s, [a.k]: a.v }),
  del: (s: State, a: { k: string }): State => {
    if (!(a.k in s)) {
      return s;
    }
    const rest: Record<string, number> = { ...s };
    delete rest[a.k];
    return rest;
  },
} satisfies Mutators<State>;

type Client = ReturnType<typeof createClient<State, typeof mutators>>;

/** Deterministic PRNG (mulberry32) so a failing seed is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s + 0x6D_2B_79_F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Delivery {
  to: number;
  patch: Patch<State>;
}

/** Per-episode constants, bundled to keep helper arity within bounds. */
interface Ctx {
  rand: () => number;
  keys: readonly string[];
  n: number;
  drop: boolean;
}

/** One random mutation from `c`, applied locally and returned. */
function issue(c: Client, ctx: Ctx): Mutation {
  const { rand, keys } = ctx;
  const k = keys[Math.floor(rand() * keys.length)] as string;
  const o = rand();
  if (o < 0.5) {
    return c.mutate("inc", { k, by: 1 + Math.floor(rand() * 3) });
  }
  if (o < 0.8) {
    return c.mutate("set", { k, v: Math.floor(rand() * 10) });
  }
  return c.mutate("del", { k });
}

/** Fan a patch out to all N clients, lossy + duplicating, into `inbox`. */
function fanout(inbox: Delivery[], patch: Patch<State>, ctx: Ctx): void {
  const { rand, n, drop } = ctx;
  for (let t = 0; t < n; t++) {
    const lost = drop && rand() < 0.25; // packet loss: resync heals it later
    if (!lost) {
      inbox.push({ to: t, patch });
      if (rand() < 0.15) {
        inbox.push({ to: t, patch }); // duplicate delivery
      }
    }
  }
}

/** Run one fuzz episode. `drop` enables packet loss (healed by a final resync). */
function episode(seed: number, drop: boolean): void {
  const rand = rng(seed);
  const n = 3 + Math.floor(rand() * 3); // 3..5 clients
  const arbiter = createArbiter<State>({ mutators, initial: {} });
  let mid = 0;
  const clients = Array.from({ length: n }, (_, i) =>
    createClient<State, typeof mutators>({
      clientId: `c${i}`,
      mutators,
      initial: arbiter.current(),
      newId: (): string => `m${String(++mid)}`,
      // Strengthen the fuzz: freeze the base (any mutator that mutates its input
      // throws) and turn a valueHash mismatch into a test failure.
      freezeForDev: true,
      onDiverge: (d): never => {
        throw new Error(`diverge at v${String(d.version)}: ${d.expected} != ${d.got}`);
      },
    }));

  const inbox: Delivery[] = [];
  const ctx: Ctx = { rand, keys: ["a", "b", "c"], n, drop };
  const rounds = 60 + Math.floor(rand() * 120);

  for (let r = 0; r < rounds; r++) {
    // A random client issues a mutation; client→arbiter is reliable (the app
    // guarantees eventual delivery via retry), so the arbiter sees them all.
    const c = clients[Math.floor(rand() * n)] as Client;
    const patch = arbiter.receive(issue(c, ctx));
    if (patch !== null) {
      fanout(inbox, patch, ctx);
    }
    // Flush a random prefix OUT OF ORDER.
    const flush = Math.floor(rand() * (inbox.length + 1));
    for (let f = 0; f < flush && inbox.length > 0; f++) {
      const d = inbox.splice(Math.floor(rand() * inbox.length), 1)[0] as Delivery;
      (clients[d.to] as Client).applyPatch(d.patch);
    }
  }

  // Drain whatever's left, still out of order.
  while (inbox.length > 0) {
    const d = inbox.splice(Math.floor(rand() * inbox.length), 1)[0] as Delivery;
    (clients[d.to] as Client).applyPatch(d.patch);
  }

  // Lossy runs heal via a reconnect resync (the arbiter's absolute snapshot).
  if (drop) {
    const snap = arbiter.resync();
    for (const c of clients) {
      c.applyPatch(snap);
    }
  }

  const truth = arbiter.current().value;
  for (const c of clients) {
    assertEquals(c.view(), truth); // converged on the truth
    assertEquals(c.pending().length, 0); // nothing stuck / lost
  }
}

Deno.test("converge: reorder + dup, reliable delivery (no resync)", () => {
  for (let seed = 1; seed <= 300; seed++) {
    episode(seed, false);
  }
});

Deno.test("converge: reorder + dup + drop, healed by resync", () => {
  for (let seed = 1; seed <= 300; seed++) {
    episode(seed, true);
  }
});
