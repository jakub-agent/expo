import { hydrate } from '../hydrate';
import { createManifest } from '../manifest';
import { planGoBack } from '../planner';
import { project } from '../project';
import { reducer } from '../reducer';
import { getMockConfig } from '../../testing-library';

// End-to-end through the real getStateFromPath matcher: URL → minimal tree (hydrate) → URL (project)
// must round-trip, and a hydrated deep link must be poppable (planner → reducer).
const config = getMockConfig(['_layout.tsx', 'index.tsx', 'details.tsx']);
const resolveKind = createManifest({ '': 'stack' });

/** Deepest focused leaf name. */
function focusedLeafName(tree: NonNullable<ReturnType<typeof hydrate>>): string {
  let node = tree.root;
  for (;;) {
    const r = node.routes[node.index];
    if (r?.child) node = r.child;
    else return r?.name ?? '';
  }
}

describe('hydrate — end-to-end with the real matcher', () => {
  it('hydrates a deep link to the minimal tree and projects back to the same URL', () => {
    const tree = hydrate('/details', config, resolveKind)!;
    expect(tree).toBeDefined();
    expect(tree.root.kind).toBe('stack');
    expect(focusedLeafName(tree)).toBe('details');
    expect(project(tree).pathname).toBe('/details');
  });

  it('hydrates the index route', () => {
    const tree = hydrate('/', config, resolveKind)!;
    expect(project(tree).pathname).toBe('/');
  });

  it('unwraps the __root slot the real matcher emits (root is the stack content, not the slot)', () => {
    const tree = hydrate('/details', config, resolveKind)!;
    // The homogeneous root is the stack content; the __root slot layer is gone.
    expect(tree.root.routes.map((r) => r.name)).toEqual(['details']);
    expect(tree.root.routes.some((r) => r.name === '__root')).toBe(false);
  });

  it('a hydrated deep link is poppable once seeded with history', () => {
    // Hydrate /details, then (as a navigator anchor seed would) insert the index anchor before it,
    // and confirm planGoBack pops back to index.
    const tree = hydrate('/details', config, resolveKind)!;
    const stackKey = tree.root.key;
    const seeded = reducer(tree, {
      type: 'insertRoute',
      nodeKey: stackKey,
      name: 'index',
      key: 'index#anchor',
      at: 0,
      focus: false,
    });
    expect(seeded.root.routes.map((r) => r.name)).toEqual(['index', 'details']);
    expect(seeded.root.index).toBe(1);
    const ops = planGoBack(seeded);
    expect(ops).toHaveLength(1);
    expect(reducer(seeded, ops[0]).root.index).toBe(0);
  });
});
