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
import { canGoBack as planCanGoBack, planGoBack, planPush } from './planner';
import { project } from './project';
import { reducer } from './reducer';
import type { GlobalNavState, Op } from './types';

const NavStateContext = createContext<GlobalNavState | null>(null);
/** The key of the nearest navigator node; the render layer scopes this per navigator (default root). */
const NavigatorNodeContext = createContext<string>(ROOT_NODE_KEY);

// Module-level bridge for the imperative router. `snapshot` is the latest intended state; `dispatch`
// hands an op to React. Read only outside render (N13).
type Bridge = { dispatch: (op: Op) => void; snapshot: GlobalNavState };
const bridge: { current: Bridge | null } = { current: null };

function commit(ops: Op[]): void {
  const b = bridge.current;
  if (!b || ops.length === 0) return;
  const single = ops.length === 1 ? ops[0] : undefined;
  const op: Op = single ?? { type: 'batch', ops };
  // Advance the snapshot synchronously so a chained imperative action sees this one's effect, then
  // hand the same op to React (reconciled by the post-commit effect to the identical committed value).
  b.snapshot = reducer(b.snapshot, op);
  b.dispatch(op);
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
    bridge.current = { dispatch: (op) => startTransition(() => rawDispatch(op)), snapshot: state };
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
