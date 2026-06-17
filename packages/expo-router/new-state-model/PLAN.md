# Plan — Rewriting Expo Router state handling to the new model

> RFC: [`./RFC.md`](./RFC.md) (source: [Notion — Router v57 / New state model](https://app.notion.com/p/381e5b573524813b8e1fcca52714542b)).
> Decisions log: [`./Decisions.md`](./Decisions.md).

This plan rewrites Expo Router's navigation **state layer** to the model described in the RFC:
a single React-owned `useReducer` holding a **homogeneous** `{ key, routes, index }` tree, with navigators
demoted to a pure rendering layer. It is sequenced into independently reviewable phases. Each phase is
challenged by fresh agents and committed only after review.

---

## 0. Current state (what we are replacing)

- State is react-navigation's **heterogeneous** `NavigationState` (`type: 'stack'|'tab'|...`, `routeNames`,
  `history`, `preloadedRoutes`, nested `state`), held in a non-reactive `storeRef` + `useSyncExternalStore`
  (`src/global-state/store.ts`, `routeInfoCache.ts`).
- Navigation flows `router.push` → `linkTo` → `routingQueue` → `navigationRef.dispatch` →
  react-navigation `getStateForAction` → `onStateChange` → store (`src/global-state/router.ts`,
  `routingQueue.ts`, `getNavigationAction.ts`).
- Navigators are built on `useNavigationBuilder` + the `Router` contract (`getInitialState`/`getStateForAction`)
  in vendored react-navigation (`src/react-navigation/**`, `src/layouts/**`).
- `src/standard-navigation/**` already exposes a **thin homogeneous contract**
  (`{ index, routes: [{ href, key, name, params }] }`, actions `navigate`/`back`) — D3 says the new layer
  must stay compatible with it.

## 1. Target model (RFC) — the contract

State shape ([RFC §"Proposed state shape (tree)"](./RFC.md#proposed-state-shape-tree)):

```ts
type GlobalNavState = { root: NavNode }
type NavNode   = { key: string; routes: RouteEntry[]; index: number }
type RouteEntry = { key: string; name: string; params?: object; child?: NavNode }
```

- **Homogeneous, no `type` in state** ([D5](./RFC.md#decisions)). How a node renders is a rendering concern.
- **Minimal global tree, hydrated from URL** ([D1](./RFC.md#decisions); [scenario 1](./RFC.md#1-creation-of-the-initial-state)):
  inactive branches are absent from global state until promoted by a navigation action.
- **Per-navigator history lives inside the tree** ([D2](./RFC.md#decisions)); `routes[0..index]` is a stack's
  back history, `routes[index]` is the top ([D6](./RFC.md#decisions) — no forward; preload is navigator-local).
- **State lives in one root `useReducer`, distributed via context** ([D12](./RFC.md#decisions)) — *not* an external
  store. The imperative `router` reaches it through a module-level `dispatch` ref + a snapshot ref for reads.
- **Navigators are a pure rendering layer** ([RFC §"Consolidated summary"](./RFC.md#consolidated-summary-of-the-original-notes)):
  render the state they receive, never mutate inline, may hold render-only/ephemeral local state, and translate
  gestures + native events into primitive reducer ops.

## 2. Architecture of the new layer

> Refined by 11 fresh-agent challenges — see [`./Decisions.md`](./Decisions.md) N1–N11. Each unit below cites the
> decision that shaped it.

New greenfield module `src/state/` ([D3](./RFC.md#decisions) greenfield; compatible with `standard-navigation` via one
projection adapter, [N3](./Decisions.md)). Built as pure, individually-testable units:

1. **`types.ts`** — `GlobalNavState`, `NavNode` (with an internal `kind`, [N1](./Decisions.md)), `RouteEntry` (with
   `child`, no `href`), primitive `Op` union, high-level `Action` union, `Target = { path, scope }` with
   `scope ∈ {absolute, relative, navigator}` ([D7](./RFC.md#decisions), [N3](./Decisions.md)).
2. **`reducer.ts`** — a **dumb** pure reducer over **primitive, key-relative ops only**:
   `setIndex`/`setIndexToKey`, `insertRoute`, `removeRoute(byKey)`, `replaceRoute`, `setParams`, `promoteChild(byKey)`,
   and `batch([...ops])`. It knows nothing about stack vs tabs and **never reads `kind`**; **no-ops when a target key is
   absent** (replay-safe). It is the single function under `useReducer` ([N2](./Decisions.md), [N5](./Decisions.md)).
3. **`manifest.ts`** — merge **linking** (URL↔path, static, from the directory tree) with **layout** (navigator
   `kind`, `initialRouteName`, guards) into one lookup keyed by node *name* ([D8](./RFC.md#decisions)). The
   `_layout → kind` manifest does **not** exist today and is real new work ([N1](./Decisions.md)).
4. **`resolveTarget.ts` + `planner.ts`** — the resolver maps `(path, scope)` → `{ nodeKey, name, params }`; the planner
   maps `(Action, manifest, snapshot)` → flat `Op[]`, reading `kind` ([C12 option A](./RFC.md#c12--action-semantics-must-be-resolvable-without-the-render-layer), [N1](./Decisions.md), [N2](./Decisions.md)).
   `goBack` walks the focused path deepest-first ([N10](./Decisions.md)). Pure ⇒ testable against every scenario's JSON.
5. **`hydrate.ts`** — URL → minimal active-path tree ([scenario 1](./RFC.md#1-creation-of-the-initial-state)). Reuses
   the fork's `getStateFromPath`; `resultStateToTree` renames `state`→`child`, defaults `index`, synthesizes stable
   keys, stamps `kind` ([N7](./Decisions.md)).
6. **`project.ts`** — focused-path tree → URL string ([scenarios 2/3](./RFC.md#2-navigation-action-dispatch--native));
   reuses `getPathFromState` via a focused-path walker. The URL is a lossy projection ([D1](./RFC.md#decisions),
   [N7](./Decisions.md)). Must reproduce today's `getRouteInfo()` pathname/segments/params exactly (golden-file test,
   [N11](./Decisions.md)).
7. **`store.tsx`** — root `useReducer` (React-owned writer); state distributed via **per-navigator context slices**;
   a module-level `dispatchRef` + `snapshotRef` (committed state) for imperative reads ([D12](./RFC.md#decisions),
   [N4](./Decisions.md)). Dispatch sets a **per-action `defer` lane** (JS nav → `startTransition`; native reconcile /
   `animation:'none'` → sync) ([D4](./RFC.md#decisions), [N5](./Decisions.md)). Global + local **seeding** runs in
   `useLayoutEffect` as a batched op with `animation: none` ([scenario 1b](./RFC.md#1b-seeding-initial-state-beyond-the-url-global--local)).
8. **`router.ts` (imperative)** — `navigate`, `goBack`, `goBackTo`, `replace`, `preload`, `reset`, `batch(() => {…})`
   ([RFC §"Actions to keep"](./RFC.md#consolidated-summary-of-the-original-notes); reset = batch), plus reads
   `canGoBack`/current URL/segments from the snapshot ref (planner-backed, [N10](./Decisions.md)).

### Navigators (rendering layer)

- **Back bubbling** ([scenarios 5/6](./RFC.md#5-back-action-in-stack), [C11](./RFC.md#c11--how-to-handle-local-back-action)):
  back bubbles from the focused route; each navigator decides whether it handles it (a stack with `index>0`
  removes the top; tabs refocus via navigator-local focus-order), else it bubbles further; if nothing handles it,
  screens decide / app exits. A `useLocalRouter` hook scopes navigation to the current navigator.
- **Stack** — renders `routes[0..index]`; `routes[index]` is the top. JS push: state-first then animate; native
  push (preview/native gesture): reconcile *after* the animation, reducer must not re-animate
  ([scenarios 2 vs 3](./RFC.md#2-navigation-action-dispatch--native)). Disappearing (popped, still animating) and
  preloaded routes are **navigator-local**, not in global state.
- **Tabs** — every tab branch is rendered in advance and kept in **navigator-local** state; a navigation action
  **promotes** a branch into global state; switching is `setIndex` ([D11](./RFC.md#decisions),
  [scenario 4](./RFC.md#4-tab-change-dispatch)). `lazy` opts a tab into React `Activity`; non-lazy tabs are
  preloaded. Cross-tab deep nav is a `batch` of `setIndex` + the in-tab op.
- **Drawer** — open/close is navigator-local; explicit drawer actions deprecated ([D10](./RFC.md#decisions)).
- **SplitView** — pick a C10 option (challenge below) ([C10](./RFC.md#c10--splitview-candidate-approaches-pick-one)).

### Batch animation ([C13](./RFC.md#c13--batch-animation-how-does-one-commit-animate))

Default to decide via challenge (candidates: `none` for reset/seed, `default` per-navigator, animate-the-diff…).

## 3. Phasing (each phase = one independently-green, reviewable commit)

> Re-sequenced after the perspective review ([N21](./Decisions.md)). The old `src/global-state/**` +
> react-navigation path stays in place behind the `EXPO_ROUTER_STATE_MODEL` flag ([N11](./Decisions.md)) until the
> per-navigator cutovers, so every phase keeps the suite green. This is built as **incremental vertical slices**, not a
> big-bang cutover — see "Scope reality" in Decisions.md.

**Vertical slice 0 — Stack, JS-only (the smallest end-to-end proof, [N21](./Decisions.md)):**

- **P1 — Pure core.** `types.ts` (node `{key,routes,index,kind,focusOrder?}`, [N12](./Decisions.md)), `reducer.ts`
  (`insertRoute`/`removeRoute`/`setIndex`/`setParams`/`promoteChild`/`batch`) with the **structural-sharing invariant**
  ([N14](./Decisions.md)) and deterministic keys ([N15](./Decisions.md)); `planner.ts` for `push`/`goBack` on
  `kind:'stack'`. **Exhaustive unit tests** for every op (incl. structural-sharing) and RFC scenarios 3 & 5. *(start here)*
- **P2 — Config & URL.** `manifest.ts` (`_layout → kind`/`initialRouteName`, [N1](./Decisions.md)), `hydrate.ts`
  (`resultStateToTree` over the reused `getStateFromPath` fork, [N7](./Decisions.md)), `project.ts` (focused-path
  walker over `getPathFromState`). **Gate: golden-file test** — new `project.ts` reproduces today's
  `getRouteInfo()` pathname/segments/params over a fixture tree ([N11](./Decisions.md)) — **must pass before P4.**
- **P3 — Root store + imperative API + reads.** `store.tsx` (root `useReducer`; per-navigator context slices +
  post-commit `snapshotRef`, [N13](./Decisions.md); per-action defer lanes + `flushSync` for sync, [N5](./Decisions.md));
  imperative `router` (correct surface: `push/navigate/replace/back/dismiss*/setParams/canGoBack`, [N19](./Decisions.md));
  reactive hooks via `useSyncExternalStore` on the committed snapshot. Tests via `renderRouter` + a trivial render layer.
- **P4-Stack — Stack render layer (native + web).** Drives `react-native-screens` from the tree via a
  `descriptors.ts` options subsystem ([N17](./Decisions.md)); `routes[0..index]`; `useLocalRouter`; navigator-local
  disappearing list. **JS push + JS back only** this slice (defer scenario 2 / preview / `singular`).
- **P5-Stack — Wire `__e2e__/stack`.** Point that one example at the new model behind the flag; green `stack` jest
  suite; run on a simulator and capture a screenshot.

**Subsequent slices (each its own challenged, green commit):**

- **Native-stack completion** — scenario 2 reconcile (iOS, [N16](./Decisions.md)), the native-dismiss op table +
  preview/preload promotion + zoom ([N18](./Decisions.md)), `singular`/`getId`, modal presentation.
- **Tabs** (JS then native) — promotion-on-nav batch ([N6](./Decisions.md)), `focusOrder` on the node
  ([N12](./Decisions.md)), `Activity`/lazy, native-tabs back asymmetry ([N16](./Decisions.md)).
- **Drawer / MaterialTopTabs / community navigators** — rewritten directly on the new render contract;
  **no shim** ([N27](./Decisions.md)). `useNavigation`/`useNavigationBuilder`/`withLayoutContext` are deprecated.
- **SplitView** ([N8](./Decisions.md)), **headless `ui`**, **`standard-navigation` bridge** ([N3](./Decisions.md)).
- **Omitted subsystems** ([N20](./Decisions.md)) — loaders/data, redirects/guards (D9), navigationEvents, RSC,
  typed-routes. (No `useNavigation` shim — deprecated, [N27](./Decisions.md).)
- **Final cutover (P5-global)** — flip the default, delete the old path + flag, full `router-e2e` green.

## 4. Open questions — resolved via fresh agents (see [`./Decisions.md`](./Decisions.md))

| Question | Resolution |
| --- | --- |
| C10 SplitView approach | Option 1, multi-visible homogeneous node; visibility navigator-local ([N8](./Decisions.md)) |
| C12 semantics location | Planner from manifest + `kind` cached on node ([N1](./Decisions.md)) |
| C13 batch animation | Default `default`; single `'none'\|undefined` hint; no per-region map in v1 ([N9](./Decisions.md)) |
| Reducer vs planner seam | Three layers: resolver → planner → dumb reducer ([N2](./Decisions.md)) |
| Reuse standard-navigation types | Own the tree; project to standard-navigation at the seam ([N3](./Decisions.md)) |
| Reuse getStateFromPath/getPathFromState | Reuse forks behind thin adapters ([N7](./Decisions.md)) |
| Transition model | Per-action lanes + key-relative ops ([N5](./Decisions.md)) |
| Android cross-tab back / web back | Planner owns Android back; web back flagged for the web render layer ([N10](./Decisions.md)) |
| Single useReducer vs store | useReducer writer + per-navigator context + snapshot ref ([N4](./Decisions.md)) |
| Tabs local vs global structure | Global is single source of truth; promote-then-apply batch ([N6](./Decisions.md)) |
| Cutover & tests | Parallel build + root flag; split shape-agnostic vs shape-coupled tests ([N11](./Decisions.md)) |

**Still genuinely open (carry into implementation, decide with agents as they arise):** web back (browser vs
simulated) for the web render layer; pass-through/styling navigators & nesting-without-a-navigator representation in the
homogeneous tree; runtime navigator changes; `Link.Preview` navigation under the new model.
