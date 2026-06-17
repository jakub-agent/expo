// Project the homogeneous tree's focused path to a URL (`UrlObject`): pathname, segments, params,
// searchParams (RFC scenarios 2/3; the URL is a lossy projection of the focused path — D1/N7).
//
// Rather than reimplement the segment→pathname logic (group stripping, dynamic/catch-all params,
// `+not-found`, trailing-`index` drop), we convert the focused path into the `FocusedRouteState`
// shape the existing `getRouteInfoFromState` already consumes and delegate to it. That makes the
// projection byte-identical to today's output, which is what lets the ~414 shape-agnostic tests pass
// unchanged on the new model (N11). `child` maps to react-navigation's nested `state`.

import { INTERNAL_SLOT_NAME } from '../constants';
import { getRouteInfoFromState, type UrlObject } from '../global-state/getRouteInfoFromState';
import type { GlobalNavState, NavNode } from './types';

type FocusedState = {
  index: number;
  routes: { name: string; params?: Record<string, unknown>; state?: FocusedState }[];
};

/** Convert a node's focused path into a focused-only react-navigation state (the only part read). */
function toFocusedState(node: NavNode): FocusedState {
  const route = node.routes[node.index];
  if (!route) return { index: 0, routes: [] };
  return {
    index: 0,
    routes: [{ name: route.name, params: route.params, state: route.child && toFocusedState(route.child) }],
  };
}

export function project(state: GlobalNavState): UrlObject {
  // `getRouteInfoFromState` expects the outermost route to be the root slot, then descends `state`.
  const wrapped = { index: 0, routes: [{ name: INTERNAL_SLOT_NAME, state: toFocusedState(state.root) }] };
  return getRouteInfoFromState(wrapped);
}
