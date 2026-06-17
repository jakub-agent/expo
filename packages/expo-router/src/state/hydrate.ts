// Hydrate a URL into the MINIMAL active-path homogeneous tree (RFC scenario 1, D1). We reuse the
// vendored `getStateFromPath` fork as the URL-matching engine — it already handles groups, dynamic
// and catch-all params, the specificity sort, `+not-found`, and initialRouteName anchoring — and
// convert its `ResultState` to the homogeneous tree with a thin recursive adapter (N7). `state` →
// `child`, missing `index` → 0, `kind` stamped from the manifest by layout path (N1).
//
// Keys: each route's ordinal is its position within the node (0..n-1) and `seq` is set to the count,
// so the reducer's monotonic mint (`name#seq`) continues without colliding with hydrated keys
// (N15/N22) — the two schemes are consistent by construction, exercised by the hydrate↔push seam test.

import { INTERNAL_SLOT_NAME } from '../constants';
import { getStateFromPath, type Options, type ResultState } from '../fork/getStateFromPath';
import { makeNodeKey, makeRouteKey } from './keys';
import type { ResolveKind } from './manifest';
import type { GlobalNavState, NavNode, RouteEntry } from './types';

/** Convert a matched `ResultState` (nested via `state`) into a homogeneous `NavNode` tree. */
export function resultStateToTree(state: ResultState, resolveKind: ResolveKind): NavNode {
  return convert(state, '', 'root', resolveKind);
}

function convert(
  rs: ResultState,
  hostPath: string,
  nodeKey: string,
  resolveKind: ResolveKind
): NavNode {
  const sourceRoutes = rs.routes ?? [];
  const routes: RouteEntry[] = sourceRoutes.map((r, ordinal) => {
    const routeKey = makeRouteKey(r.name, ordinal);
    const entry: RouteEntry = { key: routeKey, name: r.name };
    if (r.params && Object.keys(r.params).length > 0) {
      entry.params = r.params as Record<string, unknown>;
    }
    if (r.state) {
      const childPath = hostPath ? `${hostPath}/${r.name}` : r.name;
      entry.child = convert(r.state as ResultState, childPath, makeNodeKey(routeKey), resolveKind);
    }
    return entry;
  });
  return {
    key: nodeKey,
    kind: resolveKind(hostPath),
    index: rs.index ?? 0,
    seq: routes.length,
    routes,
  };
}

/**
 * `getStateFromPath` nests everything under the root slot (`__root`); the homogeneous root IS that
 * slot's content (the root navigator). Mock/flat configs may omit the slot, so unwrap it only when
 * present (matching how `project` re-wraps for the URL). Built-in `_sitemap`/`+not-found` top routes
 * are out of this slice's scope (deferred to the not-found slice, N20).
 */
export function unwrapRootSlot(result: ResultState): ResultState {
  const first = result.routes?.[0];
  return first?.name === INTERNAL_SLOT_NAME && first.state ? (first.state as ResultState) : result;
}

/** Match `path` against the linking config and hydrate the minimal tree, or `undefined` if unmatched. */
export function hydrate(
  path: string,
  options: Options<object>,
  resolveKind: ResolveKind
): GlobalNavState | undefined {
  const result = getStateFromPath(path, options);
  if (!result) return undefined;
  return { root: resultStateToTree(unwrapRootSlot(result), resolveKind) };
}
