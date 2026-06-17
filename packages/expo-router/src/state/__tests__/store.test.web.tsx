import { act, renderHook } from '@testing-library/react-native';
import * as React from 'react';

import {
  NavigatorNode,
  router,
  StateProvider,
  useLocalRouter,
  useNavState,
  usePathname,
  useSegments,
} from '../store';
import type { GlobalNavState, NavNode } from '../types';

function stack(key: string, names: string[], index = names.length - 1): NavNode {
  return { key, kind: 'stack', index, seq: names.length, routes: names.map((n, i) => ({ key: `${n}#${i}`, name: n })) };
}
function initialStack(): GlobalNavState {
  return { root: stack('root', ['index'], 0) };
}

function renderStore(initial = initialStack(), nodeKey?: string) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    nodeKey ? (
      <StateProvider initialState={initial}>
        <NavigatorNode nodeKey={nodeKey}>{children}</NavigatorNode>
      </StateProvider>
    ) : (
      <StateProvider initialState={initial}>{children}</StateProvider>
    );
  return renderHook(
    () => ({ pathname: usePathname(), segments: useSegments(), state: useNavState(), local: useLocalRouter() }),
    { wrapper }
  );
}

describe('store — reactive reads + node-scoped router', () => {
  it('projects the initial pathname', () => {
    const { result } = renderStore();
    expect(result.current.pathname).toBe('/');
    expect(result.current.segments).toEqual([]); // trailing `index` dropped
  });

  it('push updates the pathname, lands params, and enables back (RFC scenario 3)', () => {
    const { result } = renderStore();
    expect(result.current.local.canGoBack()).toBe(false);

    act(() => result.current.local.push('details', { id: '42' }));

    expect(result.current.pathname).toBe('/details');
    expect(result.current.state.root.routes[1].params).toEqual({ id: '42' });
    expect(result.current.local.canGoBack()).toBe(true);
  });

  it('back pops the focused stack (RFC scenario 5)', () => {
    const { result } = renderStore();
    act(() => result.current.local.push('details'));
    act(() => result.current.local.back());
    expect(result.current.pathname).toBe('/');
    expect(result.current.local.canGoBack()).toBe(false);
  });
});

describe('store — chained imperative actions in one tick (optimistic snapshot, N13)', () => {
  it('two pushes in one tick both land with distinct keys', () => {
    const { result } = renderStore();
    act(() => {
      result.current.local.push('a');
      result.current.local.push('b');
    });
    expect(result.current.state.root.routes.map((r) => r.key)).toEqual(['index#0', 'a#1', 'b#2']);
    expect(result.current.pathname).toBe('/b');
  });

  it('two backs in one tick pop twice (would single-pop with a stale snapshot)', () => {
    const { result } = renderStore({ root: stack('root', ['index', 'a', 'b'], 2) });
    act(() => {
      result.current.local.back();
      result.current.local.back();
    });
    expect(result.current.state.root.routes.map((r) => r.name)).toEqual(['index']);
    expect(result.current.pathname).toBe('/');
  });
});

describe('store — node-scoped useLocalRouter (N10)', () => {
  it('acts on the scoped child node, not the root', () => {
    const initial: GlobalNavState = {
      root: {
        key: 'root',
        kind: 'stack',
        index: 0,
        seq: 1,
        routes: [{ key: 'home#0', name: 'home', child: stack('home.nav', ['index'], 0) }],
      },
    };
    const { result } = renderStore(initial, 'home.nav');

    act(() => result.current.local.push('details'));

    // Pushed into the scoped child stack...
    expect(result.current.state.root.routes[0].child!.routes.map((r) => r.name)).toEqual(['index', 'details']);
    // ...and the root stack is unchanged.
    expect(result.current.state.root.routes).toHaveLength(1);
  });
});

describe('store — global imperative router', () => {
  it('reads committed state and pops', () => {
    const { result } = renderStore();
    act(() => result.current.local.push('details'));
    expect(router.canGoBack()).toBe(true);
    act(() => router.back());
    expect(result.current.pathname).toBe('/');
    expect(router.canGoBack()).toBe(false);
  });
});

describe('store — bridge lifecycle', () => {
  it('is inert once the provider unmounts (bridge cleared, no throw)', () => {
    const { result, unmount } = renderStore();
    act(() => result.current.local.push('details'));
    expect(router.canGoBack()).toBe(true); // live bridge sees history

    unmount();

    // canGoBack can only be false now because the bridge was cleared (the snapshot still had history).
    expect(router.canGoBack()).toBe(false);
    expect(() => router.back()).not.toThrow();
  });

  it('useNavState throws outside a provider', () => {
    expect(() => renderHook(() => useNavState())).toThrow(/StateProvider/);
  });
});
