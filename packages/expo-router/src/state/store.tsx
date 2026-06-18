// The root store (D12): a single React-owned `useReducer` holding the homogeneous tree, distributed
// by context. The imperative router reaches it through a module-level bridge read only OUTSIDE render
// (event handlers / imperative API), never during render (N13).
//
// The bridge `snapshot` is advanced OPTIMISTICALLY when an action is committed and reconciled in a
// post-commit effect (N13, refined): the reducer is pure and the store is the sole writer, so the
// optimistic value always equals the eventual committed state. This is what makes chained imperative
// actions in one tick correct (two pops pop twice) — a plain post-commit-only mirror would plan the
// second action against a stale snapshot. JS navigation is transition-deferred (N5); the
// native-reconcile sync/`flushSync` lane is added with the native render layer.
//
// Scope (Stack slice): node-scoped `useLocalRouter` (push/back/canGoBack) + global `router`
// (back/canGoBack) + reactive `usePathname`/`useSegments`. Full href target resolution and
// per-navigator context slicing are later increments (N4/N18).

import {
  createContext,
  startTransition,
  use,
  useLayoutEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

import { ROOT_NODE_KEY } from './keys';
import { canGoBack as planCanGoBack, findNode, planDismiss, planGoBack, planPush } from './planner';
import { project } from './project';
import { reducer } from './reducer';
import type { GlobalNavState, NavNode, Op } from './types';

const NavStateContext = createContext<GlobalNavState | null>(null);
/** The key of the nearest navigator node; the render layer scopes this per navigator (default root). */
const NavigatorNodeContext = createContext<string>(ROOT_NODE_KEY);

// Module-level bridge for the imperative router. `snapshot` is the latest intended state; `dispatch`
// hands an op to React. Read only outside render (N13).
type Bridge = { dispatch: (op: Op, defer: boolean) => void; snapshot: GlobalNavState };
const bridge: { current: Bridge | null } = { current: null };

// `defer` (the JS-navigation default) commits in a transition so a newer action can supersede the
// in-flight render (N5). The non-deferred lane is for reconciling a native gesture that ALREADY
// animated (scenario 2): a plain dispatch in the event handler commits in the same frame and must
// not re-animate.
function commit(ops: Op[], defer = true): void {
  const b = bridge.current;
  if (!b || ops.length === 0) return;
  const single = ops.length === 1 ? ops[0] : undefined;
  const op: Op = single ?? { type: 'batch', ops };
  // Advance the snapshot synchronously so a chained imperative action sees this one's effect, then
  // hand the same op to React (reconciled by the post-commit effect to the identical committed value).
  b.snapshot = reducer(b.snapshot, op);
  b.dispatch(op, defer);
}

export function StateProvider({
  initialState,
  children,
}: {
  initialState: GlobalNavState;
  children: ReactNode;
}) {
  const [state, rawDispatch] = useReducer(reducer, initialState);

  // Mirror committed state + dispatch into the module bridge for out-of-render reads (N13). JS
  // navigation defers so a new transition can supersede an in-flight render (N5).
  useLayoutEffect(() => {
    bridge.current = {
      dispatch: (op, defer) => (defer ? startTransition(() => rawDispatch(op)) : rawDispatch(op)),
      snapshot: state,
    };
    return () => {
      bridge.current = null;
    };
  }, [state]);

  return <NavStateContext value={state}>{children}</NavStateContext>;
}

/** Scope children to a navigator node so `useLocalRouter` acts on it (set by the render layer). */
export function NavigatorNode({ nodeKey, children }: { nodeKey: string; children: ReactNode }) {
  return <NavigatorNodeContext value={nodeKey}>{children}</NavigatorNodeContext>;
}

export function useNavState(): GlobalNavState {
  const state = use(NavStateContext);
  if (!state) throw new Error('useNavState must be used within a <StateProvider>.');
  return state;
}

export function usePathname(): string {
  return project(useNavState()).pathname;
}

export function useSegments(): string[] {
  return project(useNavState()).segments;
}

/** The `NavNode` for the nearest navigator (scoped by `NavigatorNode`); used by the render layer. */
export function useNavNode(): NavNode {
  const state = useNavState();
  const nodeKey = use(NavigatorNodeContext);
  const node = findNode(state.root, nodeKey);
  if (!node) throw new Error(`No navigator node "${nodeKey}" in the navigation tree.`);
  return node;
}

/** A router scoped to the nearest navigator node (C11/N10). */
export function useLocalRouter() {
  const nodeKey = use(NavigatorNodeContext);
  return useMemo(
    () => ({
      push(name: string, params?: Record<string, unknown>) {
        const b = bridge.current;
        if (b) commit(planPush(b.snapshot, nodeKey, name, params));
      },
      back() {
        const b = bridge.current;
        if (b) commit(planGoBack(b.snapshot, nodeKey));
      },
      // Reconcile a native pop/swipe-dismiss that already animated `count` screens away (scenario 2):
      // remove them from state on the sync lane so the reducer does not re-animate.
      dismiss(count = 1) {
        const b = bridge.current;
        if (b) commit(planDismiss(b.snapshot, nodeKey, count), false);
      },
      canGoBack(): boolean {
        const b = bridge.current;
        return b ? planCanGoBack(b.snapshot, nodeKey) : false;
      },
    }),
    [nodeKey]
  );
}

/** Imperative router for use outside render (event handlers, etc.). Resolves back from the snapshot. */
export const router = {
  back(): void {
    const b = bridge.current;
    if (b) commit(planGoBack(b.snapshot));
  },
  canGoBack(): boolean {
    const b = bridge.current;
    return b ? planCanGoBack(b.snapshot) : false;
  },
};
