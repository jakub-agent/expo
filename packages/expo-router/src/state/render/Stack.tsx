// The Stack render layer (P4). A pure renderer over the homogeneous tree: it reads its NavNode and
// renders `routes[0..index]` as native `ScreenStackItem`s, top-most focused. It owns no navigation
// state — it translates the native pop/dismiss gesture into a `goBack` op (scenario 2 reconcile:
// native already animated, we just remove the route from state) and lets JS pushes drive the push
// animation (scenario 3: state-first, then animate). Screen components are resolved by route name
// from `ScreensContext`; params flow through `LocalRouteParamsContext` so `useLocalSearchParams` works.

import { createContext, type ComponentType, use } from 'react';
import { StyleSheet } from 'react-native';
import { ScreenStack, ScreenStackItem } from 'react-native-screens';

import { LocalRouteParamsContext } from '../../Route';
import { useLocalRouter, useNavNode } from '../store';

/** name → screen component, for the current navigator (provided by the root layout renderer). */
export const ScreensContext = createContext<Record<string, ComponentType<object>>>({});

export function Stack() {
  const node = useNavNode();
  const screens = use(ScreensContext);
  const local = useLocalRouter();

  // A stack renders its back history up to and including the focused top (D6; no forward).
  const visible = node.routes.slice(0, node.index + 1);

  return (
    <ScreenStack style={StyleSheet.absoluteFill}>
      {visible.map((route) => {
        const Screen = screens[route.name];
        // All pushed screens are "active" in a native stack; the native stack shows the top by order.
        // react-native-screens forbids decreasing activityState, so do not demote covered screens.
        return (
          <ScreenStackItem
            key={route.key}
            screenId={route.key}
            activityState={2}
            style={StyleSheet.absoluteFill}
            stackPresentation="push"
            // Native already animated the pop/swipe-dismiss; reconcile state in one sync op without
            // re-animating (scenario 2). `dismissCount` can be >1 for a multi-screen swipe.
            onDismissed={(event) => local.dismiss(event.nativeEvent.dismissCount ?? 1)}
            onHeaderBackButtonClicked={() => local.back()}
            headerConfig={{ title: route.name }}>
            <LocalRouteParamsContext.Provider value={route.params}>
              {Screen ? <Screen /> : null}
            </LocalRouteParamsContext.Provider>
          </ScreenStackItem>
        );
      })}
    </ScreenStack>
  );
}
