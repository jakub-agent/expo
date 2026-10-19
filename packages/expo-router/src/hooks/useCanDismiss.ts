'use client';

import { use } from 'react';

import { RootNavigationStateContext } from '../react-navigation/core/RootNavigationStateContext';
import { canDismissState } from '../utils/stack';

/**
 * Returns whether a stack on the focused route can be dismissed. Unlike `router.canDismiss()`,
 * the value is current during render, so it can be used to show a close button.
 *
 * @example
 * ```tsx
 * import { router, useCanDismiss } from 'expo-router';
 * import { Button } from 'react-native';
 *
 * export default function CloseButton() {
 *   const canDismiss = useCanDismiss();
 *   return canDismiss ? <Button title="Close" onPress={() => router.dismiss()} /> : null;
 * }
 * ```
 */
export function useCanDismiss(): boolean {
  const state = use(RootNavigationStateContext);
  if (state === undefined) {
    throw new Error('useCanDismiss was called from outside of Expo Router application.');
  }
  return canDismissState(state);
}
