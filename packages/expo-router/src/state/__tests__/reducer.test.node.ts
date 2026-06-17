import { reducer } from '../reducer';
import type { GlobalNavState, NavNode, RouteEntry } from '../types';

function route(key: string, name = key.split('#')[0], child?: NavNode): RouteEntry {
  return child ? { key, name, child } : { key, name };
}

function stack(key: string, names: string[], index = names.length - 1): NavNode {
  return {
    key,
    kind: 'stack',
    index,
    seq: names.length, // monotonic counter continues past the seeded routes
    routes: names.map((n, i) => route(`${n}#${i}`)),
  };
}

describe('reducer — insertRoute', () => {
  it('pushes a route, mints a unique key, focuses it, and bumps seq (RFC scenario 3)', () => {
    const before: GlobalNavState = { root: stack('home.stack', ['index'], 0) };
    const after = reducer(before, {
      type: 'insertRoute',
      nodeKey: 'home.stack',
      name: 'details',
      params: { id: '42' },
      focus: true,
    });
    expect(after.root).toEqual({
      key: 'home.stack',
      kind: 'stack',
      index: 1,
      seq: 2,
      routes: [{ key: 'index#0', name: 'index' }, { key: 'details#1', name: 'details', params: { id: '42' } }],
    });
  });

  it('mints distinct keys for repeated pushes of the same name (replay-safe, N5/N15)', () => {
    // Applying two inserts in sequence is exactly how a transition replays queued actions against
    // the committed base; each must see the bumped `seq` and get a unique key.
    const before: GlobalNavState = { root: stack('s', ['index'], 0) };
    const after = reducer(before, {
      type: 'batch',
      ops: [
        { type: 'insertRoute', nodeKey: 's', name: 'details' },
        { type: 'insertRoute', nodeKey: 's', name: 'details' },
      ],
    });
    expect(after.root.routes.map((r) => r.key)).toEqual(['index#0', 'details#1', 'details#2']);
    expect(after.root.seq).toBe(3);
  });

  it('inserts at the focused index without focus shifts focus down (pins <= not <)', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b'], 0) }; // focused on a (index 0)
    const after = reducer(before, {
      type: 'insertRoute',
      nodeKey: 's',
      name: 'x',
      key: 'x#anchor',
      at: 0,
      focus: false,
    });
    expect(after.root.routes.map((r) => r.key)).toEqual(['x#anchor', 'a#0', 'b#1']);
    expect(after.root.index).toBe(1); // pos (0) <= index (0) → index + 1
  });

  it('seeds an anchor before the current route, keeping focus (RFC scenario 1b)', () => {
    const before: GlobalNavState = {
      root: { key: 'home.stack', kind: 'stack', index: 0, seq: 1, routes: [route('details#0', 'details')] },
    };
    const after = reducer(before, {
      type: 'insertRoute',
      nodeKey: 'home.stack',
      name: 'index',
      key: 'index#anchor',
      at: 0,
      focus: false,
    });
    expect(after.root.index).toBe(1);
    expect(after.root.routes.map((r) => r.name)).toEqual(['index', 'details']);
  });

  it('clamps an out-of-range `at` to the end', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b'], 0) };
    const after = reducer(before, { type: 'insertRoute', nodeKey: 's', name: 'c', at: 99, focus: false });
    expect(after.root.routes.map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(after.root.index).toBe(0); // pos (2) > index (0) → unchanged
  });
});

describe('reducer — removeRoute', () => {
  it('pops the focused top and decrements index (RFC scenario 5)', () => {
    const before: GlobalNavState = { root: stack('home.stack', ['index', 'list', 'details'], 2) };
    const after = reducer(before, { type: 'removeRoute', nodeKey: 'home.stack', routeKey: 'details#2' });
    expect(after.root.routes.map((r) => r.key)).toEqual(['index#0', 'list#1']);
    expect(after.root.index).toBe(1);
  });

  it('removing a route below focus shifts focus down by one', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b', 'c'], 2) };
    const after = reducer(before, { type: 'removeRoute', nodeKey: 's', routeKey: 'a#0' });
    expect(after.root.routes.map((r) => r.key)).toEqual(['b#1', 'c#2']);
    expect(after.root.index).toBe(1);
  });

  it('is a replay-safe no-op for an absent key (same reference)', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b'], 1) };
    expect(reducer(before, { type: 'removeRoute', nodeKey: 's', routeKey: 'missing#9' })).toBe(before);
  });

  it('never removes the last remaining route (structural integrity)', () => {
    const before: GlobalNavState = { root: stack('s', ['a'], 0) };
    expect(reducer(before, { type: 'removeRoute', nodeKey: 's', routeKey: 'a#0' })).toBe(before);
  });
});

describe('reducer — setIndex', () => {
  it('sets a valid index', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b', 'c'], 0) };
    expect(reducer(before, { type: 'setIndex', nodeKey: 's', index: 2 }).root.index).toBe(2);
  });

  it('ignores unchanged / out-of-range / negative index (same reference)', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b'], 1) };
    expect(reducer(before, { type: 'setIndex', nodeKey: 's', index: 1 })).toBe(before);
    expect(reducer(before, { type: 'setIndex', nodeKey: 's', index: 5 })).toBe(before);
    expect(reducer(before, { type: 'setIndex', nodeKey: 's', index: -1 })).toBe(before);
  });
});

describe('reducer — batch', () => {
  it('applies surviving ops and silently skips an op on an absent key', () => {
    const before: GlobalNavState = { root: stack('s', ['a'], 0) };
    const after = reducer(before, {
      type: 'batch',
      ops: [
        { type: 'insertRoute', nodeKey: 's', name: 'b' },
        { type: 'removeRoute', nodeKey: 's', routeKey: 'gone#9' }, // no-op
        { type: 'insertRoute', nodeKey: 's', name: 'c' },
      ],
    });
    expect(after.root.routes.map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(after.root.index).toBe(2);
  });

  it('returns the same root reference when every op no-ops', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b'], 1) };
    const after = reducer(before, {
      type: 'batch',
      ops: [
        { type: 'setIndex', nodeKey: 'nope', index: 0 },
        { type: 'removeRoute', nodeKey: 's', routeKey: 'missing#9' },
      ],
    });
    expect(after).toBe(before);
  });
});

describe('reducer — structural sharing (N14)', () => {
  it('keeps untouched sibling branches at the same object reference', () => {
    const home = route('home#0', 'home', stack('home.stack', ['index'], 0));
    const search = route('search#1', 'search', stack('search.stack', ['index', 'results'], 1));
    const before: GlobalNavState = {
      root: { key: 'root', kind: 'tabs', index: 0, seq: 2, routes: [home, search] },
    };

    const after = reducer(before, { type: 'insertRoute', nodeKey: 'home.stack', name: 'details', focus: true });

    // The touched branch is a new object...
    expect(after.root.routes[0]).not.toBe(before.root.routes[0]);
    expect(after.root.routes[0].child).not.toBe(before.root.routes[0].child);
    // ...but the untouched sibling keeps its exact reference (route AND child).
    expect(after.root.routes[1]).toBe(before.root.routes[1]);
    expect(after.root.routes[1].child).toBe(before.root.routes[1].child);
  });

  it('shares identity through more than one level of nesting', () => {
    const deep = stack('deep.stack', ['a'], 0);
    const mid: NavNode = {
      key: 'mid.stack',
      kind: 'stack',
      index: 0,
      seq: 2,
      routes: [route('sub#0', 'sub', deep), route('other#1', 'other')],
    };
    const home = route('home#0', 'home', mid);
    const search = route('search#1', 'search', stack('search.stack', ['index'], 0));
    const before: GlobalNavState = {
      root: { key: 'root', kind: 'tabs', index: 0, seq: 2, routes: [home, search] },
    };

    const after = reducer(before, { type: 'insertRoute', nodeKey: 'deep.stack', name: 'b', focus: true });

    // The whole spine root → home → mid → deep is rebuilt...
    expect(after.root).not.toBe(before.root);
    expect(after.root.routes[0]).not.toBe(before.root.routes[0]);
    expect(after.root.routes[0].child).not.toBe(mid);
    // ...the uncle two levels up keeps its reference...
    expect(after.root.routes[1]).toBe(search);
    // ...and the deep sibling that was not touched keeps its reference.
    expect(after.root.routes[0].child!.routes[1]).toBe(mid.routes[1]);
  });

  it('returns the same root reference when an op targets an absent node', () => {
    const before: GlobalNavState = { root: stack('s', ['a', 'b'], 1) };
    expect(reducer(before, { type: 'setIndex', nodeKey: 'nope', index: 0 })).toBe(before);
  });
});
