// The new state model currently renders the root navigator as a Stack regardless of this _layout
// (the layout/manifest wiring is a later slice). Kept minimal so the route tree is well-formed.
import { Stack } from 'expo-router';

export default function Layout() {
  return <Stack />;
}
