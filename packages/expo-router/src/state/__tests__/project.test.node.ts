import { INTERNAL_SLOT_NAME } from '../../constants';
import { getRouteInfoFromState } from '../../global-state/getRouteInfoFromState';
import { project } from '../project';
import type { GlobalNavState, NavNode, RouteEntry } from '../types';

function route(key: string, name: string, params?: Record<string, unknown>, child?: NavNode): RouteEntry {
  return { key, name, ...(params ? { params } : {}), ...(child ? { child } : {}) };
}
function node(key: string, kind: NavNode['kind'], index: number, routes: RouteEntry[]): NavNode {
  return { key, kind, index, seq: routes.length, routes };
}

describe('project — focused path → URL', () => {
  it('projects the focused path, with non-path params as query (RFC scenarios 2/3)', () => {
    const tree: GlobalNavState = {
      root: node('root', 'tabs', 0, [
        route('home#0', 'home', undefined, node('home.stack', 'stack', 1, [
          route('index#0', 'index'),
          route('details#1', 'details', { id: '42' }),
        ])),
      ]),
    };
    const url = project(tree);
    expect(url.pathname).toBe('/home/details');
    expect(url.segments).toEqual(['home', 'details']);
    expect(url.params).toEqual({ id: '42' });
    expect(url.pathnameWithParams).toBe('/home/details?id=42');
  });

  it('strips group segments and drops a trailing index', () => {
    const tree: GlobalNavState = {
      root: node('root', 'stack', 0, [
        route('(tabs)#0', '(tabs)', undefined, node('tabs', 'tabs', 0, [
          route('home#0', 'home', undefined, node('home.stack', 'stack', 0, [route('index#0', 'index')])),
        ])),
      ]),
    };
    const url = project(tree);
    expect(url.pathname).toBe('/home');
    // segments keep the group (pathname strips it) and drop the trailing `index`.
    expect(url.segments).toEqual(['(tabs)', 'home']);
  });

  it('resolves a dynamic segment from params', () => {
    const tree: GlobalNavState = {
      root: node('root', 'stack', 0, [
        route('profile#0', 'profile', undefined, node('profile.stack', 'stack', 0, [
          route('[id]#0', '[id]', { id: '42' }),
        ])),
      ]),
    };
    const url = project(tree);
    expect(url.pathname).toBe('/profile/42');
    expect(url.params).toEqual({ id: '42' });
    expect(url.pathnameWithParams).toBe('/profile/42'); // id consumed by the path, not a query param
  });
});

describe('project — golden parity with getRouteInfoFromState (N11)', () => {
  it('matches feeding an equivalent full react-navigation state', () => {
    const tree: GlobalNavState = {
      root: node('root', 'tabs', 1, [
        route('home#0', 'home', undefined, node('home.stack', 'stack', 0, [route('index#0', 'index')])),
        route('search#1', 'search', { q: 'hi' }, node('search.stack', 'stack', 1, [
          route('index#0', 'index'),
          route('results#1', 'results'),
        ])),
      ]),
    };

    // The same focused arrangement expressed as a full react-navigation state (with sibling routes
    // the projection must ignore), wrapped in the root slot the store actually renders.
    const rnState = {
      index: 0,
      routes: [
        {
          name: INTERNAL_SLOT_NAME,
          state: {
            index: 1,
            routes: [
              { name: 'home', state: { index: 0, routes: [{ name: 'index' }] } },
              {
                name: 'search',
                params: { q: 'hi' },
                state: { index: 1, routes: [{ name: 'index' }, { name: 'results' }] },
              },
            ],
          },
        },
      ],
    };

    const fromTree = project(tree);
    const fromState = getRouteInfoFromState(rnState as Parameters<typeof getRouteInfoFromState>[0]);

    expect(fromTree.pathname).toBe(fromState.pathname);
    expect(fromTree.segments).toEqual(fromState.segments);
    expect(fromTree.params).toEqual(fromState.params);
    expect(fromTree.pathnameWithParams).toBe(fromState.pathnameWithParams);
    expect(fromTree.searchParams.toString()).toBe(fromState.searchParams.toString());

    // And the concrete expected values.
    expect(fromTree.pathname).toBe('/search/results');
    expect(fromTree.pathnameWithParams).toBe('/search/results?q=hi');
  });
});
