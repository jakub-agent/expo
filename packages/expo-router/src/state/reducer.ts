// The dumb reducer: applies primitive, key-relative ops to the homogeneous tree (N2). It knows
// nothing about stack vs tabs and never reads `kind`. Three invariants it must uphold:
//
//   1. Structural sharing (N14): any node/route it does not touch keeps its exact object reference,
//      so per-navigator context slices and `React.memo` can bail out. Reached via `updateNode`,
//      which returns the same reference when nothing below changed.
//   2. Replay-safe no-ops (N5): an op targeting an absent key returns state unchanged (same
//      reference), so a deferred op replayed against a newer base cannot corrupt the tree.
//   3. Unique keys (N5/N15): the reducer mints a route key from the node's monotonic `seq` at apply
//      time, so two inserts — including a transition replaying queued actions — never collide.

import { makeRouteKey } from './keys';
import type { GlobalNavState, NavNode, Op, RouteEntry } from './types';

export function reducer(state: GlobalNavState, op: Op): GlobalNavState {
  const root = applyOp(state.root, op);
  return root === state.root ? state : { root };
}

function applyOp(root: NavNode, op: Op): NavNode {
  switch (op.type) {
    case 'batch':
      return op.ops.reduce(applyOp, root);
    case 'setIndex':
      return updateNode(root, op.nodeKey, (n) =>
        op.index === n.index || op.index < 0 || op.index >= n.routes.length
          ? n
          : { ...n, index: op.index }
      );
    case 'insertRoute':
      return updateNode(root, op.nodeKey, (n) =>
        insertRoute(n, op.name, op.params, op.key, op.at, op.focus)
      );
    case 'removeRoute':
      return updateNode(root, op.nodeKey, (n) => removeRoute(n, op.routeKey));
    default:
      return root;
  }
}

// --- node-level edits (operate on the matched node, return a new node only if it changed) ---

function insertRoute(
  n: NavNode,
  name: string,
  params?: Record<string, unknown>,
  key?: string,
  at = n.routes.length,
  focus = true
): NavNode {
  // Mint the key from the live node's counter unless the caller supplied one (seed/hydrate anchor).
  const routeKey = key ?? makeRouteKey(name, n.seq);
  const route: RouteEntry = params !== undefined ? { key: routeKey, name, params } : { key: routeKey, name };
  const pos = clamp(at, 0, n.routes.length);
  const routes = [...n.routes.slice(0, pos), route, ...n.routes.slice(pos)];
  let index = n.index;
  if (focus) index = pos;
  else if (pos <= n.index) index = n.index + 1;
  return { ...n, routes, index, seq: n.seq + 1 };
}

function removeRoute(n: NavNode, routeKey: string): NavNode {
  const i = n.routes.findIndex((r) => r.key === routeKey);
  // Absent key → no-op (replay-safe). A node must keep at least one route and a valid index
  // (structural integrity); the planner bubbles back to the parent rather than emptying a node.
  if (i < 0 || n.routes.length === 1) return n;
  const routes = [...n.routes.slice(0, i), ...n.routes.slice(i + 1)];
  // Removing the focused route or one below it shifts focus down by one (scenario 5: index--).
  const index = clamp(i <= n.index ? n.index - 1 : n.index, 0, routes.length - 1);
  return { ...n, routes, index };
}

// --- structural-sharing traversal ---

/** Apply `fn` to the node whose key matches, rebuilding only the spine above it. Same ref if absent. */
function updateNode(node: NavNode, nodeKey: string, fn: (n: NavNode) => NavNode): NavNode {
  if (node.key === nodeKey) return fn(node);
  let changed = false;
  const routes = node.routes.map((r) => {
    if (!r.child) return r;
    const child = updateNode(r.child, nodeKey, fn);
    if (child === r.child) return r;
    changed = true;
    return { ...r, child };
  });
  return changed ? { ...node, routes } : node;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
