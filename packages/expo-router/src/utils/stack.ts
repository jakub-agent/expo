import type { ReactNavigationState } from '../global-state/types';

export function getHistoryLength(state: ReactNavigationState): number {
  if (state.history) {
    return state.history.length;
  }

  if (state.type === 'stack') {
    if (state.index === undefined) {
      return 1;
    }

    // All routes after `state.index` are preloaded.
    return state.index + 1;
  }

  // Without a type or history, stack and tabs both use the route count as their history length.
  return state.routes.length;
}

export function canDismissState(state: ReactNavigationState | undefined): boolean {
  // Keep traversing down the state tree until we find a stack navigator that we can pop
  while (state) {
    // TODO(ENG-22019): Detect typeless stacks, including anchor/initialRouteName states that start
    // with multiple routes.
    if (state.type === 'stack' && getHistoryLength(state) > 1) {
      return true;
    }
    if (state.index === undefined) return false;

    state = state.routes?.[state.index]?.state;
  }

  return false;
}
