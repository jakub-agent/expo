import { act } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useCanDismiss } from '../exports';
import { router } from '../imperative-api';
import Stack from '../layouts/Stack';
import { renderRouter } from '../testing-library';

it('reads the current stack during render and matches router.canDismiss()', async () => {
  const renders: { index: boolean[]; second: boolean[] } = { index: [], second: [] };
  function route(name: keyof typeof renders) {
    return function Screen() {
      renders[name].push(useCanDismiss());
      return <Text>{name}</Text>;
    };
  }

  await renderRouter({ _layout: () => <Stack />, index: route('index'), second: route('second') });
  expect(renders.index).not.toContain(true);
  expect(router.canDismiss()).toBe(false);

  await act(() => router.push('/second'));
  expect(renders.second[0]).toBe(true);
  expect(router.canDismiss()).toBe(true);

  await act(() => router.back());
  expect(renders.index.at(-1)).toBe(false);
  expect(router.canDismiss()).toBe(false);
});
