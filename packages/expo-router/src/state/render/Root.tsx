// The new-model root (P4), selected behind the EXPO_ROUTER_STATE_MODEL flag in ExpoRoot. Mirrors the
// existing boot — getRoutes → getLinkingConfig → match the initial URL — but hydrates the homogeneous
// tree (N7) and renders it with the new render layer instead of NavigationContainer.
//
// Scope: the root navigator is a Stack (manifest `{ '': 'stack' }`); multi-navigator manifests and
// the per-_layout navigator declaration are later slices.

import { Platform } from 'react-native';
import { type ComponentType, useMemo } from 'react';

import { extractExpoPathFromURL } from '../../fork/extractPathFromURL';
import { defaultRouteInfo } from '../../global-state/getRouteInfoFromState';
import { getLinkingConfig } from '../../getLinkingConfig';
import { getRoutes } from '../../getRoutes';
import type { RouteNode } from '../../Route';
import type { RequireContext } from '../../types';
import { resultStateToTree, unwrapRootSlot } from '../hydrate';
import { createManifest } from '../manifest';
import { ROOT_NODE_KEY } from '../keys';
import { StateProvider } from '../store';
import type { GlobalNavState } from '../types';
import { ScreensContext, Stack } from './Stack';

/** Resolve `name → component` for a layout node's direct route children. */
function buildScreens(layout: RouteNode): Record<string, ComponentType<object>> {
  const screens: Record<string, ComponentType<object>> = {};
  for (const child of layout.children) {
    if (child.type === 'route') {
      const component = child.loadRoute()?.default as ComponentType<object> | undefined;
      if (component) screens[child.route] = component;
    }
  }
  return screens;
}

const EMPTY: GlobalNavState = { root: { key: ROOT_NODE_KEY, kind: 'stack', index: 0, seq: 0, routes: [] } };

export function StateModelRoot({ context, initialPath }: { context: RequireContext; initialPath?: string }) {
  // Building the route tree, linking config, initial tree, and screen map is pure work derived from
  // the context + initial URL — memoize so it runs once, not on every render.
  const boot = useMemo(() => {
    const routeNode = getRoutes(context, {
      skipGenerated: true,
      ignoreEntryPoints: true,
      platform: Platform.OS,
      preserveRedirectAndRewrites: true,
    });
    if (!routeNode) return null;

    const linking = getLinkingConfig(routeNode, context, () => defaultRouteInfo, {
      metaOnly: true,
      skipGenerated: true,
      sitemap: false,
      notFound: false,
    });
    const resolveKind = createManifest({ '': 'stack' });

    let path = initialPath;
    if (path == null) {
      const initialURL = linking.getInitialURL?.();
      path = typeof initialURL === 'string' ? extractExpoPathFromURL(linking.prefixes, initialURL) : '/';
    }
    if (!path.startsWith('/')) path = '/' + path;

    const result = linking.getStateFromPath(path, linking.config);
    const initialState: GlobalNavState = result
      ? { root: resultStateToTree(unwrapRootSlot(result), resolveKind) }
      : EMPTY;

    return { initialState, screens: buildScreens(routeNode) };
  }, [context, initialPath]);

  if (!boot) return null;

  return (
    <StateProvider initialState={boot.initialState}>
      <ScreensContext.Provider value={boot.screens}>
        <Stack />
      </ScreensContext.Provider>
    </StateProvider>
  );
}
