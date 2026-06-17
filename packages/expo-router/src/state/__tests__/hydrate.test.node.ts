import { INTERNAL_SLOT_NAME } from '../../constants';
import { resultStateToTree, unwrapRootSlot } from '../hydrate';
import { createManifest } from '../manifest';
import { reducer } from '../reducer';
import type { ResultState } from '../../fork/getStateFromPath';

// Root layout is a tabs navigator; each tab hosts a stack (keyed by layout PATH, '' = root).
const resolveKind = createManifest({ '': 'tabs', home: 'stack' });

// Build a ResultState the way getStateFromPath emits it (nested via `state`).
function rs(state: unknown): ResultState {
  return state as ResultState;
}

describe('resultStateToTree — converter (RFC scenario 1)', () => {
  it('converts a minimal active path, stamping kind from the manifest by path', () => {
    const tree = resultStateToTree(
      rs({ index: 0, routes: [{ name: 'home', state: { index: 0, routes: [{ name: 'index' }] } }] }),
      resolveKind
    );
    expect(tree).toEqual({
      key: 'root',
      kind: 'tabs',
      index: 0,
      seq: 1,
      routes: [
        {
          key: 'home#0',
          name: 'home',
          child: {
            key: 'home#0.nav',
            kind: 'stack',
            index: 0,
            seq: 1,
            routes: [{ key: 'index#0', name: 'index' }],
          },
        },
      ],
    });
  });

  it('hydrates only the deep-linked route (RFC scenario 1b "Before") with params', () => {
    const tree = resultStateToTree(
      rs({ index: 0, routes: [{ name: 'home', state: { index: 0, routes: [{ name: 'details', params: { id: '42' } }] } }] }),
      resolveKind
    );
    const homeStack = tree.routes[0].child!;
    expect(homeStack.routes).toEqual([{ key: 'details#0', name: 'details', params: { id: '42' } }]);
    expect(homeStack.index).toBe(0);
    expect(homeStack.kind).toBe('stack');
  });

  it('defaults a missing index to 0 and sets seq to the route count', () => {
    const tree = resultStateToTree(rs({ routes: [{ name: 'a' }, { name: 'b' }] }), createManifest({ '': 'stack' }));
    expect(tree.index).toBe(0);
    expect(tree.seq).toBe(2);
    expect(tree.routes.map((r) => r.key)).toEqual(['a#0', 'b#1']);
  });

  it('omits params when empty and never emits a child for a leaf', () => {
    const tree = resultStateToTree(rs({ index: 0, routes: [{ name: 'a', params: {} }] }), createManifest({ '': 'stack' }));
    expect(tree.routes[0]).toEqual({ key: 'a#0', name: 'a' });
    expect(tree.routes[0].child).toBeUndefined();
  });
});

describe('hydrate↔reducer key seam (N15/N22)', () => {
  it('hydrated positional keys and reducer-minted keys never collide for repeated names', () => {
    const tree = { root: resultStateToTree(rs({ index: 1, routes: [{ name: 'a' }, { name: 'a' }] }), createManifest({ '': 'stack' })) };
    expect(tree.root.routes.map((r) => r.key)).toEqual(['a#0', 'a#1']);
    expect(tree.root.seq).toBe(2);
    const after = reducer(tree, { type: 'insertRoute', nodeKey: 'root', name: 'a' });
    const keys = after.root.routes.map((r) => r.key);
    expect(keys).toEqual(['a#0', 'a#1', 'a#2']);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('unwrapRootSlot', () => {
  it('unwraps the __root slot to its content when present (production linking)', () => {
    const content = { index: 0, routes: [{ name: 'home' }] };
    const result = rs({ index: 0, routes: [{ name: INTERNAL_SLOT_NAME, state: content }] });
    expect(unwrapRootSlot(result)).toBe(content as unknown);
  });

  it('returns the result unchanged when there is no __root slot (flat/mock config)', () => {
    const flat = rs({ index: 0, routes: [{ name: 'home' }] });
    expect(unwrapRootSlot(flat)).toBe(flat);
  });
});

describe('manifest — createManifest', () => {
  it('resolves kind by full layout path and root by empty string', () => {
    const m = createManifest({ '': 'tabs', home: 'stack', 'home/details': 'stack' });
    expect(m('')).toBe('tabs');
    expect(m('home')).toBe('stack');
    expect(m('home/details')).toBe('stack');
  });

  it('throws (does not guess) for an unregistered layout path', () => {
    const m = createManifest({ '': 'tabs' });
    expect(() => m('settings')).toThrow(/No navigator kind registered/);
  });
});
