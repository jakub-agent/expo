// Core types for the new homogeneous navigation state model (RFC §"Proposed state shape").
//
// Every node has the SAME shape — there is no `type: 'stack' | 'tabs'`. How a node renders is a
// rendering decision; how an action resolves against it is decided by `kind`, which is behavioral
// metadata stamped from the static manifest (Decisions N1/N12), NOT a structural type.
//
// Scope: this is vertical slice 0 — Stack push + Stack back. Tabs/split semantics (focus-order,
// promotion, set-index-to-key), `replaceRoute`, and `setParams` arrive in their own slices (N18/N21).

/** Behavioral kind of a navigator node — picked from the static `_layout` manifest (N1). */
export type NodeKind = 'stack' | 'tabs';

export type RouteEntry = {
  key: string;
  name: string;
  params?: Record<string, unknown>;
  /** Nested navigator hosted by this route, if any. */
  child?: NavNode;
};

export type NavNode = {
  key: string;
  /** tabs OR history OR columns — the renderer decides. */
  routes: RouteEntry[];
  /** The focused route within `routes`. */
  index: number;
  kind: NodeKind;
  /**
   * Monotonic insert counter used to mint unique, replay-safe route keys (N5/N15). It only ever
   * increases, so two inserts applied in sequence — including a deferred transition replaying queued
   * actions against the committed base — always get distinct keys. The reducer owns it; never random.
   */
  seq: number;
};

export type GlobalNavState = { root: NavNode };

// Primitive, key-relative operations — the ONLY thing the reducer applies (N2). Key-relative so a
// deferred transition can replay an op against a newer committed base; the reducer no-ops when a
// target key is absent (N5). The reducer never reads `kind`. New routes are described by `name`
// (+ optional `params`); the reducer mints the key, so the planner never bakes in a stale ordinal.
export type Op =
  | { type: 'setIndex'; nodeKey: string; index: number }
  | {
      type: 'insertRoute';
      nodeKey: string;
      name: string;
      params?: Record<string, unknown>;
      /** Explicit key for seeded/hydrated routes (anchors); omit to let the reducer mint one. */
      key?: string;
      /** Defaults to the end of `routes`. */
      at?: number;
      /** Whether the inserted route becomes focused. Defaults to true. */
      focus?: boolean;
    }
  | { type: 'removeRoute'; nodeKey: string; routeKey: string }
  | { type: 'batch'; ops: Op[] };
