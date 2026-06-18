import { fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { Pressable, Text } from 'react-native';

import { useLocalSearchParams } from '../../../hooks/useLocalSearchParams';
import { LocalRouteParamsContext } from '../../../Route';
import { inMemoryContext } from '../../../testing-library/context-stubs';
import { useLocalRouter } from '../../store';
import { StateModelRoot } from '../Root';

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

const context = inMemoryContext({ _layout: () => null, index: Home, details: Details });

describe('StateModelRoot — full boot pipeline', () => {
  it('hydrates the initial URL from the route tree and renders the focused screen', () => {
    render(<StateModelRoot context={context} initialPath="/" />);
    expect(screen.getByTestId('home')).toBeTruthy();
    expect(screen.queryByTestId('details')).toBeNull();
  });

  it('pushes a route resolved from the route tree and renders it with params', () => {
    render(<StateModelRoot context={context} initialPath="/" />);
    fireEvent.press(screen.getByTestId('go'));
    expect(screen.getByTestId('details')).toHaveTextContent('Details 42');
  });

  it('hydrates a deep link directly to the focused screen (minimal tree, no index seeded)', () => {
    render(<StateModelRoot context={context} initialPath="/details" />);
    expect(screen.getByTestId('details')).toBeTruthy();
    // D1 minimal hydration: only the active path, so the home/index screen is not present.
    expect(screen.queryByTestId('home')).toBeNull();
  });
});

describe('StateModelRoot — params via the real useLocalSearchParams hook', () => {
  it('threads dynamic params to the focused screen', () => {
    const ctx = inMemoryContext({
      _layout: () => null,
      index: () => null,
      '[id]': function Profile() {
        const { id } = useLocalSearchParams<{ id: string }>();
        return <Text testID="profile">Profile {id}</Text>;
      },
    });
    render(<StateModelRoot context={ctx} initialPath="/123" />);
    expect(screen.getByTestId('profile')).toHaveTextContent('Profile 123');
  });
});
