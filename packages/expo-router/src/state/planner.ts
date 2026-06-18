// The planner: maps a high-level navigation action to primitive ops, reading `kind` off the
// committed tree (N1/N2). It is pure and resolvable without any mounted component — the point of
// C12. This slice covers `push` and `goBack` for stacks (RFC scenarios 3 & 5); path/scope target
// resolution (resolveTarget) and the remaining actions land in later slices (N18).

import type { GlobalNavState, NavNode, Op } from './types';

/** Find a node by key, depth-first. */
export function findNode(node: NavNode, key: string): NavNode | undefined {
  if (node.key === key) return node;
  for (const r of node.routes) {
    if (r.child) {
      const found = findNode(r.child, key);
      if (found) return found;
    }
  }
  return undefined;
}

/** The chain of nodes from `start` down to the deepest focused leaf (follows `index` → `child`). */
export function focusedPath(start: NavNode): NavNode[] {
  const path = [start];
  let cur = start;
  for (;;) {
    const focused = cur.routes[cur.index];
    if (!focused?.child) break;
    path.push(focused.child);
    cur = focused.child;
  }
  return path;
}

/**
 * Plan a push of `name` onto the stack node `targetNodeKey` (RFC scenario 3 — state-first, the
 * navigator animates after). The reducer mints the route key from the live node, so the planner
 * never bakes in a stale ordinal (N5/N15).
 */
export function planPush(
  state: GlobalNavState,
  targetNodeKey: string,
  name: string,
  params?: Record<string, unknown>
): Op[] {
  if (!findNode(state.root, targetNodeKey)) return [];
  return [{ type: 'insertRoute', nodeKey: targetNodeKey, name, params, focus: true }];
}

/**
 * Plan a back action by walking the focused path deepest-first, consulting `kind`, and emitting the
 * op at the first node that can handle it (N10). A stack with `index > 0` removes its focused top
 * (the reducer does index--; RFC scenario 5). Anything else bubbles further; tabs back lands in the
 * Tabs slice. If nothing handles it, returns `[]` — the caller lets screens decide / the app exit.
 */
export function planGoBack(state: GlobalNavState, fromNodeKey?: string): Op[] {
  const start = fromNodeKey ? findNode(state.root, fromNodeKey) : state.root;
  if (!start) return [];
  const path = focusedPath(start);
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (!node) continue;
    const top = node.routes[node.index];
    if (node.kind === 'stack' && node.index > 0 && top) {
      return [{ type: 'removeRoute', nodeKey: node.key, routeKey: top.key }];
    }
  }
  return [];
}

/** Whether `goBack` would do anything from the given start (defaults to the root focused leaf). */
export function canGoBack(state: GlobalNavState, fromNodeKey?: string): boolean {
  return planGoBack(state, fromNodeKey).length > 0;
}

/**
 * Plan removing the top `count` routes of the stack node `nodeKey` — the reconcile for a native
 * multi-pop/swipe-dismiss that already animated (scenario 2 / N16 iOS). Each op targets a distinct
 * route key, so the order the reducer applies them in does not matter. Capped so the node keeps its
 * root route. The caller commits these on the SYNC lane so the reducer does not re-animate.
 */
export function planDismiss(state: GlobalNavState, nodeKey: string, count = 1): Op[] {
  const node = findNode(state.root, nodeKey);
  if (!node) return [];
  const removeCount = Math.min(Math.max(count, 0), node.index);
  return node.routes
    .slice(node.index - removeCount + 1, node.index + 1)
    .map((route) => ({ type: 'removeRoute', nodeKey: node.key, routeKey: route.key }));
}
