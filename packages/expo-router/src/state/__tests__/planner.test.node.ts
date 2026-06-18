import { canGoBack, findNode, focusedPath, planDismiss, planGoBack, planPush } from '../planner';
import { reducer } from '../reducer';
import type { GlobalNavState, NavNode, Op, RouteEntry } from '../types';

function route(key: string, name = key.split('#')[0], child?: NavNode): RouteEntry {
  return child ? { key, name, child } : { key, name };
}
function stack(key: string, names: string[], index = names.length - 1): NavNode {
  return { key, kind: 'stack', index, seq: names.length, routes: names.map((n, i) => route(`${n}#${i}`)) };
}
/** Apply planned ops through the real reducer, mirroring how the store commits an action. */
function apply(state: GlobalNavState, ops: Op[]): GlobalNavState {
  return ops.reduce(reducer, state);
}

describe('planner — focusedPath / findNode', () => {
  it('walks from root down to the deepest focused leaf', () => {
    const home = route('home#0', 'home', stack('home.stack', ['index'], 0));
    const search = route('search#1', 'search', stack('search.stack', ['index', 'results'], 1));
    const state: GlobalNavState = { root: { key: 'root', kind: 'tabs', index: 1, seq: 2, routes: [home, search] } };
    expect(focusedPath(state.root).map((n) => n.key)).toEqual(['root', 'search.stack']);
    expect(findNode(state.root, 'search.stack')?.routes.length).toBe(2);
    expect(findNode(state.root, 'missing')).toBeUndefined();
  });

  it('does not throw when index is out of range', () => {
    const node: NavNode = { key: 's', kind: 'stack', index: 5, seq: 2, routes: [route('a#0'), route('b#1')] };
    expect(focusedPath(node).map((n) => n.key)).toEqual(['s']);
  });
});

describe('planner — planPush (RFC scenario 3)', () => {
  it('emits an insert by name (no baked key) that, applied, lands focused', () => {
    const before: GlobalNavState = { root: stack('home.stack', ['index'], 0) };
    const ops = planPush(before, 'home.stack', 'details', { id: '42' });
    expect(ops).toEqual([
      { type: 'insertRoute', nodeKey: 'home.stack', name: 'details', params: { id: '42' }, focus: true },
    ]);
    const after = apply(before, ops);
    expect(after.root.index).toBe(1);
    expect(after.root.routes.map((r) => r.key)).toEqual(['index#0', 'details#1']);
  });

  it('is a no-op for an unknown target node', () => {
    const before: GlobalNavState = { root: stack('home.stack', ['index'], 0) };
    expect(planPush(before, 'nope', 'details')).toEqual([]);
  });
});

describe('planner — planGoBack', () => {
  it('pops the focused stack (RFC scenario 5)', () => {
    const before: GlobalNavState = { root: stack('home.stack', ['index', 'list', 'details'], 2) };
    const ops = planGoBack(before);
    expect(ops).toEqual([{ type: 'removeRoute', nodeKey: 'home.stack', routeKey: 'details#2' }]);
    expect(apply(before, ops).root.routes.map((r) => r.key)).toEqual(['index#0', 'list#1']);
  });

  it('resolves back at the deepest stack, not an ancestor', () => {
    const inner = stack('home.stack', ['index', 'details'], 1);
    const before: GlobalNavState = {
      root: { key: 'root', kind: 'tabs', index: 0, seq: 1, routes: [route('home#0', 'home', inner)] },
    };
    expect(planGoBack(before)).toEqual([{ type: 'removeRoute', nodeKey: 'home.stack', routeKey: 'details#1' }]);
  });

  it('returns no ops when the focused stack is at its root and nothing else handles back', () => {
    const before: GlobalNavState = {
      root: {
        key: 'root',
        kind: 'tabs',
        index: 0,
        seq: 1,
        routes: [route('home#0', 'home', stack('home.stack', ['index'], 0))],
      },
    };
    expect(planGoBack(before)).toEqual([]);
    expect(canGoBack(before)).toBe(false);
  });

  it('does not throw when the focused stack has an out-of-range index', () => {
    const node: NavNode = { key: 's', kind: 'stack', index: 9, seq: 1, routes: [route('a#0')] };
    expect(planGoBack({ root: node })).toEqual([]);
  });

  it('canGoBack is true when the focused stack has history', () => {
    const before: GlobalNavState = { root: stack('home.stack', ['index', 'details'], 1) };
    expect(canGoBack(before)).toBe(true);
  });
});

describe('planner — planDismiss (native multi-pop reconcile, scenario 2)', () => {
  it('removes the top route by default', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b', 'c'], 2) };
    const ops = planDismiss(before, 's');
    expect(ops).toEqual([{ type: 'removeRoute', nodeKey: 's', routeKey: 'c#2' }]);
    expect(apply(before, ops).root.routes.map((r) => r.key)).toEqual(['a#0', 'b#1']);
  });

  it('removes the top `count` routes at distinct keys', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b', 'c'], 2) };
    const ops = planDismiss(before, 's', 2);
    expect(ops.map((o) => (o.type === 'removeRoute' ? o.routeKey : null))).toEqual(['b#1', 'c#2']);
    expect(apply(before, ops).root.routes.map((r) => r.key)).toEqual(['a#0']);
  });

  it('never removes below the root route', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b'], 1) };
    const ops = planDismiss(before, 's', 5); // cap to index (1)
    expect(apply(before, ops).root.routes.map((r) => r.key)).toEqual(['a#0']);
  });

  it('is a no-op for an unknown node', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b'], 1) };
    expect(planDismiss(before, 'nope', 1)).toEqual([]);
  });
});

describe('planner — scoped back via fromNodeKey (useLocalRouter, N10)', () => {
  it('starts the traversal at the given node', () => {
    const homeStack = stack('home.stack', ['index', 'details'], 1);
    const searchStack = stack('search.stack', ['index'], 0);
    const state: GlobalNavState = {
      root: {
        key: 'root',
        kind: 'tabs',
        index: 1, // focused tab is search (at its root)
        seq: 2,
        routes: [route('home#0', 'home', homeStack), route('search#1', 'search', searchStack)],
      },
    };
    // Global back finds nothing (search stack is at root, tabs back not in this slice)...
    expect(planGoBack(state)).toEqual([]);
    // ...but scoped to the home stack it pops, even though home is not the focused tab.
    expect(planGoBack(state, 'home.stack')).toEqual([
      { type: 'removeRoute', nodeKey: 'home.stack', routeKey: 'details#1' },
    ]);
    expect(canGoBack(state, 'home.stack')).toBe(true);
  });

  it('returns no ops for an unknown fromNodeKey', () => {
    const before: GlobalNavState = { root: stack('home.stack', ['index', 'details'], 1) };
    expect(planGoBack(before, 'does-not-exist')).toEqual([]);
  });
});
