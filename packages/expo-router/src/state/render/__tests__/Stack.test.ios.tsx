import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { Pressable, Text } from 'react-native';
import { ScreenStackItem } from 'react-native-screens';

import { LocalRouteParamsContext } from '../../../Route';
import { StateProvider, useLocalRouter } from '../../store';
import type { GlobalNavState } from '../../types';
import { ScreensContext, Stack } from '../Stack';

// Spy on ScreenStackItem so we can assert the rendered order (which screen is on top) and fire the
// native dismiss event, while still rendering the real component.
jest.mock('react-native-screens', () => {
  const actual = jest.requireActual('react-native-screens') as typeof import('react-native-screens');
  return { ...actual, ScreenStackItem: jest.fn((props) => <actual.ScreenStackItem {...props} />) };
});
const MockedItem = ScreenStackItem as unknown as jest.Mock;

function Home() {
  const router = useLocalRouter();
  return (
    <>
      <Text testID="home">Home</Text>
      <Pressable testID="go" onPress={() => router.push('details', { id: '42' })}>
        <Text>go</Text>
      </Pressable>
    </>
  );
}
function Details() {
  const params = (React.use(LocalRouteParamsContext) ?? {}) as { id?: string };
  return <Text testID="details">Details {String(params.id)}</Text>;
}
const screens = { index: Home, details: Details };

function makeStack(names: string[], index = names.length - 1): GlobalNavState {
  return {
    root: {
      key: 'root',
      kind: 'stack',
      index,
      seq: names.length,
      routes: names.map((n, i) => ({ key: `${n}#${i}`, name: n })),
    },
  };
}

function renderStack(initialState = makeStack(['index'])) {
  return render(
    <StateProvider initialState={initialState}>
      <ScreensContext.Provider value={screens}>
        <Stack />
      </ScreensContext.Provider>
    </StateProvider>
  );
}

/** Props of the most recent ScreenStackItem render with the given screenId. */
function itemProps(screenId: string) {
  const calls = MockedItem.mock.calls.filter((c) => c[0].screenId === screenId);
  return calls[calls.length - 1][0];
}

describe('Stack render layer', () => {
  it('renders the focused route initially', () => {
    renderStack();
    expect(screen.getByTestId('home')).toBeTruthy();
    expect(screen.queryByTestId('details')).toBeNull();
  });

  it('push renders the pushed screen with its params, on top of the history (scenario 3)', () => {
    renderStack();
    MockedItem.mockClear();
    fireEvent.press(screen.getByTestId('go'));

    expect(screen.getByTestId('details')).toHaveTextContent('Details 42');
    // The renderer emits items in route order, so the pushed screen is last (the native top).
    expect(MockedItem.mock.calls.map((c) => c[0].screenId)).toEqual(['index#0', 'details#1']);
  });

  it('JS/header back removes the focused screen (scenario 5)', () => {
    renderStack();
    fireEvent.press(screen.getByTestId('go'));
    act(() => itemProps('details#1').onHeaderBackButtonClicked());
    expect(screen.queryByTestId('details')).toBeNull();
    expect(screen.getByTestId('home')).toBeTruthy();
  });

  it('native dismiss (already animated) reconciles state without re-pushing (scenario 2)', () => {
    renderStack();
    fireEvent.press(screen.getByTestId('go'));
    expect(screen.getByTestId('details')).toBeTruthy();

    act(() => itemProps('details#1').onDismissed({ nativeEvent: { dismissCount: 1 } }));

    expect(screen.queryByTestId('details')).toBeNull();
    expect(screen.getByTestId('home')).toBeTruthy();
  });

  it('native multi-pop (dismissCount > 1) removes all dismissed screens at once', () => {
    // [index, details#1, details#2] focused on the second details.
    renderStack(makeStack(['index', 'details', 'details']));
    expect(MockedItem.mock.calls.some((c) => c[0].screenId === 'details#2')).toBe(true);

    act(() => itemProps('details#2').onDismissed({ nativeEvent: { dismissCount: 2 } }));

    // Both details screens are gone; back at the root.
    expect(screen.getByTestId('home')).toBeTruthy();
    expect(screen.queryByTestId('details')).toBeNull();
  });

  it('renders nothing for a route name with no registered screen (no crash)', () => {
    renderStack(makeStack(['ghost']));
    expect(screen.queryByTestId('home')).toBeNull();
    // The ScreenStackItem is still emitted (with no child), so the stack stays consistent.
    expect(MockedItem.mock.calls.map((c) => c[0].screenId)).toContain('ghost#0');
  });
});
