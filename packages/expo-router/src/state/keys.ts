// Deterministic key synthesis (N15). Keys must be stable across server/client and unique within a
// node, so hydration and later promotion agree — never `nanoid()`/random. The reducer mints route
// keys from a per-node monotonic counter (`NavNode.seq`), so this is the one place the format lives.

/**
 * Key for a route minted at insert time. `seq` is the node's monotonic counter, so the suffix is
 * unique and replay-safe (two inserts get distinct keys) while mirroring the RFC fixtures
 * (`index#0`, `details#1`).
 */
export function makeRouteKey(name: string, seq: number): string {
  return `${name}#${seq}`;
}

/** Key for the navigator node hosted by a route. Derived from the route key so hydration is stable. */
export function makeNodeKey(routeKey: string): string {
  return `${routeKey}.nav`;
}
