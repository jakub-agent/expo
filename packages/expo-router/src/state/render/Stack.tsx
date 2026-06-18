// The Stack render layer (P4). A pure renderer over the homogeneous tree: it reads its NavNode and
// renders `routes[0..index]` as native `ScreenStackItem`s, top-most focused. It owns no navigation
// state — it translates the native pop/dismiss gesture into a `goBack` op (scenario 2 reconcile:
// native already animated, we just remove the route from state) and lets JS pushes drive the push
// animation (scenario 3: state-first, then animate). Screen components are resolved by route name
// from `ScreensContext`; params flow through `LocalRouteParamsContext` so `useLocalSearchParams` works.
//
// react-native-screens hosts each screen as a separate native scene, and React context does not
// reach across that boundary — so we RE-PROVIDE the store contexts (state + node scope) inside each
// `ScreenStackItem`, mirroring how react-navigation re-establishes its contexts per screen.

import { createContext, type ComponentType, use } from 'react';
import { StyleSheet } from 'react-native';
import { ScreenStack, ScreenStackItem } from 'react-native-screens';

import { LocalRouteParamsContext } from '../../Route';
import { NavigatorNodeContext, NavStateContext, useLocalRouter, useNavNode, useNavState } from '../store';

/** name → screen component, for the current navigator (provided by the root layout renderer). */
export const ScreensContext = createContext<Record<string, ComponentType<object>>>({});

export function Stack() {
  const state = useNavState();
  const node = useNavNode();
  const screens = use(ScreensContext);
  const local = useLocalRouter();

  // A stack renders its back history up to and including the focused top (D6; no forward).
  const visible = node.routes.slice(0, node.index + 1);

  return (
    <ScreenStack style={StyleSheet.absoluteFill}>
      {visible.map((route) => {
        const Screen = screens[route.name];
        return (
          <ScreenStackItem
            key={route.key}
            screenId={route.key}
            // All pushed screens are "active" in a native stack; the native stack shows the top by
            // order. react-native-screens forbids decreasing activityState, so don't demote covered
            // screens (preload, when added, uses 0).
            activityState={2}
            style={StyleSheet.absoluteFill}
            stackPresentation="push"
            // Native already animated the pop/swipe-dismiss; reconcile state in one sync op without
            // re-animating (scenario 2). `dismissCount` can be >1 for a multi-screen swipe.
            onDismissed={(event) => local.dismiss(event.nativeEvent.dismissCount ?? 1)}
            onHeaderBackButtonClicked={() => local.back()}
            headerConfig={{ title: route.name }}>
            {/* Re-provide the store contexts across the native-screen boundary (see file header). */}
            <NavStateContext value={state}>
              <NavigatorNodeContext value={node.key}>
                <LocalRouteParamsContext.Provider value={route.params}>
                  {Screen ? <Screen /> : null}
                </LocalRouteParamsContext.Provider>
              </NavigatorNodeContext>
            </NavStateContext>
          </ScreenStackItem>
        );
      })}
    </ScreenStack>
  );
}
