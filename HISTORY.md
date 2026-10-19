## 2026-10-19 04:22 PDT — Restore layout child query parameters

**Asked:** Restore SDK 57 behavior so `useLocalSearchParams` in a layout includes query parameters from the focused child route, with regression coverage.

**Did / why:** Read the route-scoped navigation state in layouts and merge parameters along the focused child path. This avoids subscribing every screen to broad navigator state while restoring child query parameters and keeping updates reactive.
