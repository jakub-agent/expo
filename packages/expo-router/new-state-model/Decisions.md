# Decisions & observations — new state model

Running log of decisions and observations made while planning and implementing the RFC rewrite.
Newest at the top within each section. Each decision links to the relevant RFC part.

## Conventions

- **RFC** = [`./RFC.md`](./RFC.md). Decision/challenge IDs (D1–D12, C10–C13) and scenario numbers (1–6) refer to it.
- A decision is recorded here once it has been **challenged by a fresh agent** and chosen.

## Observations (current codebase)

- **O1.** State today is react-navigation's heterogeneous `NavigationState`, held in a non-reactive `storeRef`
  + `useSyncExternalStore` (`src/global-state/store.ts`, `routeInfoCache.ts`) — *not* a React `useReducer`. The RFC's
  [D12](./RFC.md#decisions) (single root `useReducer`) is a fundamental change.
- **O2.** Navigators are built on `useNavigationBuilder` + the `Router` contract (`getInitialState`/`getStateForAction`)
  in vendored react-navigation. The RFC demotes them to a pure render layer.
- **O3.** `src/standard-navigation/**` already defines a thin homogeneous contract
  (`{ index, routes: [{ href, key, name, params }] }`, actions `navigate`/`back`). [D3](./RFC.md#decisions) requires
  compatibility, so the new types should align with it where possible.
- **O4.** `getStateFromPath`/`getPathFromState` forks (`src/fork/`) already do URL↔nested-state conversion; they are
  candidate building blocks for `hydrate`/`project`.

## Decisions

> Each decision below was challenged by a fresh agent (workflow `challenge-state-model-decisions`,
> 11 parallel agents) reading the RFC + current code. IDs reference [`./RFC.md`](./RFC.md).

### N1 — Where action semantics live: planner + `kind` cached on the node ([C12](./RFC.md#c12--action-semantics-must-be-resolvable-without-the-render-layer), [D5](./RFC.md#decisions), [D8](./RFC.md#decisions))

Use a **planner** (RFC C12 option A) to resolve a high-level action into primitive ops from the **static
manifest** (linking+layout merged by node name). To avoid re-looking-up by name on every read, **stamp a
lightweight `kind` (`stack|tabs|split|…`) onto each `NavNode` when the node is first created** (by
`hydrate`/`planner`, the only writers). The **reducer never reads `kind`** and stays dump. Reject render-layer-owned
semantics outright — the current code (`getNavigationAction.ts:34` reads `navigationRef.getRootState()`, remaps by
`type`) proves it breaks for unmounted/background branches, which is exactly why C12 was reopened. There is an explicit
TODO in `router.ts:75-77` wishing for "static configuration internally" — this is that.

- **Why `kind` is not a D5 violation:** D5 forbids a *structural* `type` that changes node **shape**; a behavior
  `kind` does not change shape (RFC C12 itself: "a behavior tag is not a structural type"). It must remain an internal
  field dropped by the `standard-navigation` projection ([N3](#n3)).
- Drop the separate "C" intent→primitive layer from the plan; the planner *is* that step (redundant per minimalism).
- **Prereq:** a static `_layout → kind` manifest does **not** exist today (`RouteNode.type` is only
  `route|api|layout|redirect|rewrite`; kind only emerges at render). Building it ([P2](./PLAN.md)) is real, unavoidable
  work behind D8.

### N2 — Three-layer seam: target resolver → pure planner → dumb reducer ([D4](./RFC.md#decisions), [D5](./RFC.md#decisions), [D12](./RFC.md#decisions))

Keep the dumb-reducer seam, drawn as three pure units (the codebase already smears this across
`getNavigationAction.ts` + `getStateForAction` + the routing queue):

1. **target resolver** — `(path, scope)` → `{ nodeKey, name, params }` (reuse `findDivergentState` logic).
2. **planner** — `(Action, manifest, snapshot)` → flat `Op[]`. Reads `kind`. Pure.
3. **reducer** — applies primitive ops only (`setIndex`, `insertRoute`, `removeRoute`, `replaceRoute`, `setParams`,
   `promoteChild`, `batch`). Knows nothing about stack vs tabs. The single function under `useReducer`.

Do **not** let the reducer own high-level actions (that is react-navigation's `getStateForAction` — the 684/550-line
routers + ~5700 lines of tests this rewrite exists to replace). The flat-`Op[]` commit is what makes D4 transitions
additive and C13 animate-the-diff possible.

### N3 — Own the nested tree types; `standard-navigation` is a per-navigator projection ([D2](./RFC.md#decisions), [D3](./RFC.md#decisions), [D5](./RFC.md#decisions)) {#n3}

Define our own internal types (RFC tree, **keep `child` nesting**):

```ts
type GlobalNavState = { root: NavNode }
type NavNode    = { key: string; routes: RouteEntry[]; index: number; kind: NodeKind /* N1, internal */ }
type RouteEntry = { key: string; name: string; params?: object; child?: NavNode }
```

- **Do NOT store `href` in the tree** — it is a lossy projection ([D1](./RFC.md#decisions)), computed at the boundary.
- `standard-navigation`'s flat `NavigatorState = {index, routes:[{href,key,name,params}]}` is **not in conflict**: it
  is what a single navigator level sees. Satisfy D3 with **one adapter** `projectToStandard(node) → NavigatorState`
  that drops `child`/`kind` and computes `href`. Import standard-navigation's published types verbatim at that seam.
- `child` (singular, optional) matches file-based routing (one `_layout` per route dir) and still covers SplitView
  ([N8](#n8)) — a multi-visible node is one `NavNode` with several visible `routes`, each with its own `child`.

### N4 — `useReducer` is the React-owned writer; distribute via per-navigator context + snapshot ref ([D4](./RFC.md#decisions), [D11](./RFC.md#decisions), [D12](./RFC.md#decisions))

State lives in **one root `useReducer`** (React-owned ⇒ no tearing, transitions deferrable — the D4/D12 reason). For
distribution, **do not pass the whole tree through one plain context value** (re-renders every pre-rendered tab on any
commit). Instead: **each rendered navigator provides its own `NavNode` subtree via context**, so children subscribe to
the nearest slice and re-renders are bounded. **Imperative reads** (`canGoBack`, current URL/segments) read a
**module-level snapshot ref** updated synchronously on every commit (mirrors committed state).

- *Tension noted:* a `useSyncExternalStore`-mirror for reactive reads (as the challenger leaned toward) is **not**
  deferrable by transitions, conflicting with D4. So reactive reads stay React-owned (context); only **imperative,
  out-of-render** reads use the snapshot ref. Revisit with selector-context only if profiling shows fan-out pain.
- SSR/RSC: scope the snapshot per request (reuse existing `serverLocationContext.ts`); provide `getServerSnapshot`.

### N5 — Transitions are per-action lanes, not a blanket wrap; ops are key-relative ([D4](./RFC.md#decisions), [scenario 2](./RFC.md#2-navigation-action-dispatch--native), [scenario 3](./RFC.md#3-navigation-action-dispatch--js))

Reject wrapping every dispatch in `startTransition`. The dispatch carries `defer: boolean`:

- **DEFERRED** (`startTransition`) — JS-originated nav (scenario 3): state commits, then navigator animates.
- **SYNC** (plain dispatch) — native-already-animated reconcile (scenario 2; reducer must **not** re-animate) and
  `animation:'none'` seed/reset batches ([1b](./RFC.md#1b-seeding-initial-state-beyond-the-url-global--local), [C13](./RFC.md#c13--batch-animation-how-does-one-commit-animate)).

The lane is set at the **single dispatch boundary** in `store.tsx`. Because a deferred update replays queued reducer
actions on the latest committed base, the **planner must emit key/route-relative ops** (`removeRoute(byKey)`,
`promoteChild(byKey)`, `setIndexToKey`) — never absolute indices off a stale snapshot — and the reducer **no-ops when a
target key is absent**. "Committed state is never lost" is then a property of the pure reducer, not of `startTransition`.

### N6 — Global state is the single source of truth for tab structure (amends D11 wording) ([D1](./RFC.md#decisions), [D11](./RFC.md#decisions), [scenario 4](./RFC.md#4-tab-change-dispatch))

The "subtree in navigator-local AND global-after-promotion" framing creates two writers for a tab's history. Resolve:

- **Navigator-local state for tabs holds ONLY render ephemera** — React `Activity` mount state, disappearing-screen
  animations, focus-order ([N10](#n10)). It is **never authoritative for structure** (`routes`/`index`).
- Keep the RFC's **lazy global promotion** (scenario 4 fixtures show `search` absent before the switch, so we do **not**
  eagerly seed all tabs). A **structural navigation into an unpromoted tab is a planner `batch`** that *promotes the
  branch* (at its `initialRouteName`/target) **then** applies the in-tab op, atomically in one reducer call.
- A never-promoted tab renders its initial route locally from the manifest; it has **no** authoritative structural
  state until promoted. This keeps D1's minimal tree and removes the divergence risk.
- Key stability: hydrate/seed must assign deterministic keys (today: `${name}-${nanoid()}`), or promotion mismatches.

### N7 — Reuse the `getStateFromPath`/`getPathFromState` forks behind thin adapters ([D1](./RFC.md#decisions), [D8](./RFC.md#decisions), [D9](./RFC.md#decisions), [scenario 1](./RFC.md#1-creation-of-the-initial-state))

**Reuse** the vendored fork as the URL-matching engine; add two pure adapters:

- `resultStateToTree(ResultState) → NavNode` for `hydrate` — a ~30-line recursive rename (`state`→`child`,
  `index ?? 0`, synthesize stable keys). `ResultState` and `NavNode` are near-isomorphic.
- a focused-path walker feeding `getPathFromState` for `project` (lossy, focused-path-only — already what
  `getActiveRoute` does).

Do **not** reimplement matching: groups-invisible-in-URL, dynamic `:param`, catch-all `*`, the ~150-line specificity
sorter, `+not-found`→`*not-found` bubbling (D9), and `initialRouteName` anchoring (which *is* scenario 1b's "After")
are battle-tested behind ~3400 lines of tests. Key-synthesis policy must be shared with the reducer's insert/promote ops.

### N8 — SplitView = homogeneous multi-visible node; visibility is navigator-local ([C10](./RFC.md#c10--splitview-candidate-approaches-pick-one), [D5](./RFC.md#decisions), [D6](./RFC.md#decisions)) {#n8}

Adopt **C10 option 1**: one `{key,routes,index}` node whose renderer shows several routes at once; `routes` are the
**columns** (one RouteEntry per column), per-column history lives in each column's **`child`** stack, `index` is the
**focused column** (sole back/focus anchor). Column **visibility** (which columns are simultaneously on-screen) is
device/size-class dependent and owned natively by `Split.Host` — keep it **navigator-local/native**, not in state
(option 2's `visible:key[]` is a de-facto type leak that duplicates what the OS computes). Column **count is static**
from the manifest. This fixes the documented per-column-history gap (current e2e `_layout.tsx` TODO) with zero new
primitive ops (column focus change = `setIndex`; in-column nav = normal stack ops on `child`).

### N9 — Batch animation default = `default`; single `'none'|undefined` hint; no per-region map in v1 ([C13](./RFC.md#c13--batch-animation-how-does-one-commit-animate), [D5](./RFC.md#decisions), [scenario 1b](./RFC.md#1b-seeding-initial-state-beyond-the-url-global--local))

A batch's net commit animates with **`default`** — each affected navigator runs its own standard transition for its
net diff (the zero-code path; matches today's per-navigator animation). **`none`** is reserved for reset/seed (1b) and
the scenario-2 reconcile. The batch carries a single top-level hint `'none' | undefined` (undefined = default). **No
per-region `{navigatorKey:animation}` map and no animate-the-diff in v1** (animate-the-diff can't tell scenario 2 from
scenario 3 without an explicit flag; both violate minimalism). Reuse the existing
`__internal_expo_router_no_animation` convention rather than inventing a parallel one. Crossfade/custom/per-region are
addable later behind the same hint without an API break.

### N10 — Back resolved by the planner walking the focused path; focus-order moves onto the tabs node ([C11](./RFC.md#c11--how-to-handle-local-back-action), [C12](./RFC.md#c12--action-semantics-must-be-resolvable-without-the-render-layer), [scenario 5](./RFC.md#5-back-action-in-stack), [scenario 6](./RFC.md#6-back-action-in-tabs)) {#n10}

**Planner resolves `goBack`** by walking the committed tree deepest-first along the focused path, consulting `kind`,
emitting the op at the first node that can handle it (stack `index>0` → `removeRoute+setIndex`; tabs with a previous
focus-order entry → `setIndex`, no route removed; else ascend; root reached → screens decide / exit). **Not** runtime
bubbling through mounted navigators (today's `useOnAction.tsx:66-142`) — that is the C12-violating coupling, and it
can't see unmounted branches. `canGoBack` becomes the matching pure predicate over the snapshot (removes the
`router.ts:78` `isReady()` guard). `canDismiss` (`router.ts:84-103`) is already this exact deepest-first walk — proof it works.

- **Focus-order** is needed by the planner, so it **cannot be pure component-local**. Store it on the **tabs node** in
  the global tree (an optional `focusOrder?: string[]`), mirroring today's in-state `TabRouter.history`. RFC line 347
  ("focus-order is navigator-local") predates the C12 reopening; this amends it.
- **Android hardware back:** one root `BackHandler` → `router.canGoBack()/back()` (planner-backed). Return `false` ⇒
  app exits (the "nothing handles" fallthrough). The planner owns Android cross-tab back (open question resolved).
- **Native-reported back** (gesture/preview dismiss) emits the already-known op directly on that navigator key,
  bypassing the planner's "who handles it" step (native already decided + animated) — guard against double-handling.
- **`useLocalRouter` (C11):** closes over `navigatorKey` from a `NavigatorNodeContext`, forwards to the planner with
  `target = { path, scope: 'navigator', navigatorKey }` (D7). `back()` starts the traversal at this node;
  strictly-scoped by default. No `openDrawer`/`closeDrawer` actions (D10).

### N11 — Cutover: parallel build + root flag; split tests into shape-agnostic vs shape-coupled ([D3](./RFC.md#decisions), [PLAN P1–P5](./PLAN.md))

Build `src/state/` alongside the old path (greenfield, D3). Add **one switch** read once at the root
(`EXPO_ROUTER_STATE_MODEL=new|old`) so the new layer runs under `renderRouter` before the P5 cutover (avoids a big-bang
flip). Test strategy from a real count of the suite:

- **≈414 assertions** go through `getPathname()/getSegments()/getSearchParams()/toHavePathname` (shape-agnostic) — they
  **must pass on the new model** via a faithful `project.ts` (D1 says URL is a projection anyway). Add a golden-file
  test comparing old vs new projection over a fixture tree before P4.
- **≈50 occurrences** in **6 files** assert raw RN state via `getRouterState()/toHaveRouterState` (shape-coupled).
  Under the flag, make `getRouterState()` throw "not supported on new state model"; fork those files into
  `*.newstate.test` variants asserting the homogeneous tree using the RFC scenarios' before/after JSON as fixtures.
- `prefetch.test` (preload) is a **behavioral** redefinition, not a mechanical rewrite (D6: preload is navigator-local,
  absent from global state) — new fixtures come from the decided preload model.
- Delete the old path **and** the flag in the **P5** commit (don't leave it to bit-rot).

## Perspective review outcomes (android / ios / react-native / react / general)

> Five fresh agents reviewed the plan from their lens. Consensus: the seam (resolver→planner→dumb reducer,
> manifest-driven semantics, URL-as-projection, fork reuse) is sound; the plan **undersells the render-layer and
> compatibility work by ~an order of magnitude**, the native platforms diverge from the iOS-centric RFC scenarios, and
> the React-runtime substrate has real holes. Decisions below (N12–N21) incorporate the fixes.

### N12 — The node is honestly `{ key, routes, index, kind, focusOrder? }`; reconcile N6↔N10 (general, react)

N6 (focus-order is navigator-local) and N10 (focus-order on the tabs node) **contradicted**. Resolve in favor of **N10**:
focus-order lives on the **tabs node in the global tree** because the planner must read it without a mounted component.
Amend N6: navigator-local for tabs holds only `Activity` mount state + disappearing animations, **not** focus-order.
Stop claiming a 3-field homogeneous node — the real shape is `{ key, routes, index, kind, focusOrder? }`. Defend it
honestly: `kind` and `focusOrder` are **behavioral metadata the planner reads**, not a structural `type` that changes
how the tree is walked (D5's actual line). Both are dropped by the `standard-navigation` projection ([N3](#n3)).

### N13 — `snapshotRef` is post-commit, read only outside render; scenario-2 reconcile uses `flushSync` (react)

A `useReducer` reducer runs **during render**, which under concurrency may be discarded/restarted — so "snapshot updated
synchronously on commit" is **not achievable inside the reducer**. Correct it:

- `snapshotRef`/`dispatchRef` are written in a **post-commit `useEffect`** at the root and **read only outside render**
  (event handlers, imperative API). Imperative reads (`canGoBack`, URL) are therefore **"last committed"** and may lag
  an in-flight transition by one commit (acceptable; matches today's `onStateChange` mirror).
- For **reactive** reads (`usePathname`/`useSegments`/testing-library), keep a `useSyncExternalStore` layered on the
  committed snapshot (mirror the existing `routeInfoSubscribers` in `routeInfoCache.ts:37-44`); accept those are **not**
  transition-deferrable (do not claim context makes everything deferrable).
- **Scenario 2** (native already animated) needs the JS commit before the next native frame ⇒ use **`flushSync`**, not a
  plain dispatch ("SYNC = plain dispatch" was wrong — a plain dispatch in an event handler is still batched). Add a
  dev-assert that the refs aren't read during render (React Compiler safety, [CLAUDE.md](../CLAUDE.md) requirement).

### N14 — Reducer structural-sharing invariant + per-navigator `React.memo` (react)

The per-navigator context-slice re-render bounding ([N4](#n4)) is **false unless** the reducer guarantees **structural
sharing**: every op returns the **same object reference** for every `child`/`RouteEntry` it did not touch. Make this a
**hard P1 reducer invariant with tests** ("op on branch A leaves branch B's `child` reference identical"), paired with
`React.memo`/`useMemo` boundaries per navigator. Without it, an ancestor `setIndex` rebuilds the whole spine and every
provider re-renders — exactly the fan-out N4 claims to avoid.

### N15 — Deterministic keys (not `nanoid`), one shared key module (react, general)

Key synthesis must be **deterministic** (path/index-derived, or `useId`-seeded), not `nanoid()` — otherwise SSR/client
hydration mismatches and deep-link-then-promote double-creates a node ([N6](#n6) flagged this). One shared key module is
used by `hydrate.ts`, `planner.ts`, and the reducer's insert/promote ops so keys always agree.

### N16 — Native platform asymmetry: scenario 2 is iOS-only; Android back is JS-single-owner (android, ios)

The RFC scenarios are **iOS-centric**. Correct the native model:

- **Scenario 2** (native already animated → reconcile after) is **iOS / native-push-capable only** (Link.Preview +
  native push; `link/preview/native.tsx:10` gates `areNativeViewsAvailable` to iOS). On **Android** there is no native
  push reconcile — it is **pure scenario 3** (JS-first).
- **Android system back** (hardware button + predictive gesture) is **JS-single-owner for stacks today**: the native
  stack **disables** its gesture (`NativeStackView.native.tsx:344-350`, `nativeBackButtonDismissalEnabled={false}`),
  routing everything through one JS `BackHandler`. N10's "native-reported back bypasses the planner / guard against
  double-handling" is **iOS-only**; on Android the BackHandler reads the snapshot synchronously, returns the
  consume-decision, then dispatches. The planner owns Android **cross-tab** back **for JS tabs only**.
- **Native tabs** back is owned by **native Jetpack Compose** (`backBehavior: 'none'|'initialRoute'|'history'`,
  `NativeBottomTabsNavigator.tsx:27`); tab changes echo to JS via `onTabSelected`→op. Split **JS-tabs back** (planner +
  `focusOrder`) from **native-tabs back** (native policy emits ops). `Activity` lazy applies to **JS** navigators;
  native tabs are mounted by the Compose `Tabs.Host`, not React `<Activity>`.
- **Predictive back (Android 14)** is **out of scope for v1**; note the deferred-commit model ([N5](#n5)) makes it
  harder (the previous-destination preview must be ready at gesture-start, before a deferred commit). Don't silently
  regress; don't silently claim support.

### N27 — No compatibility shims; `useNavigation` / `useNavigationBuilder` / `withLayoutContext` are deprecated (user steer, 2026-06-17)

**Supersedes the shim half of [N17](#n17).** Per the user: do **not** build a `useNavigationBuilder`
synthesis shim or any react-navigation-compat layer. `useNavigation` (the full `NavigationProp`) will be
**deprecated**, not preserved. Consequences:

- The new hooks (`useRouter`, `usePathname`, `useSegments`, `useLocalSearchParams`, `useLocalRouter`, …)
  are built **directly** on the new store; there is no synthesized `NavigationState`/`type`/`routeNames`.
- First-party navigators (Stack, Tabs, Drawer, SplitView, native-tabs) are **rewritten directly** on the
  new render contract. Third-party/community navigators built on `withLayoutContext`/`useNavigationBuilder`
  are **not** shimmed — they migrate to the new contract or are dropped; the old hooks emit deprecation.
- This removes the largest compatibility workstream the react-native review flagged. The N17 point that
  the **options system** (4-layer merge / `setOptions` / function-form options) is a named runtime
  subsystem (`descriptors.ts`) **still stands** — it is rebuilt on the new layer, not via the old shim.

### N17 — Options are a named subsystem, not the manifest; (shim half superseded by [N27](#n27)) {#n17}
### N17 (original) — Keep a `useNavigationBuilder` shim; options are a named subsystem, not the manifest (react-native)

Demoting navigators to a pure render layer ([N2](#n2)) **deletes the foundation** of `withLayoutContext` +
`useNavigationBuilder` + descriptor/options-merging that **all** third-party navigators, Drawer, MaterialTopTabs, and
the standard-navigation bridge depend on. Decide explicitly:

- **First-party Stack/Tabs** get native render layers driven by the new tree.
- **Keep a thin `useNavigationBuilder` shim** that reads the new global slice and **synthesizes** the react-navigation
  `NavigationState` (synthetic `type`/`routeNames`/`history`/`preloadedRoutes`/`stale`) for `withLayoutContext`
  consumers, so Drawer/MaterialTopTabs/community navigators keep working through the cutover. N2's "no `getStateForAction`"
  is then true only for first-party navigators.
- The **options system** — the 4-layer merge (`navigator.screenOptions`→`Group`→`Screen.options`→`navigation.setOptions`),
  function-form options, Stack composition (`Header`/`SearchBar`/`Title`) — is **runtime**, lives in a named
  `descriptors.ts` unit, and is **not** the (static) manifest. `projectToStandard` does not produce descriptors/options.

### N18 — The planner reproduces real router behavior; preloaded routes render via a navigator-local channel (react-native, ios, general)

The 7 primitive ops do **not** capture shipped behavior. The op set + planner must cover: `singular`/`getId` dedup
(`StackClient` `stackRouterOverride`), `dismiss(count)`/`dismissTo`/`dismissAll`/`canDismiss`, `popTo`/`POP_TO_TOP`,
`setParams` target resolution, `replace`-vs-`push` dedup, param `merge`, and `dismissCount>1` from native pops. Budget
the planner as a **re-implementation of ~11k LOC of router behavior** (`StackRouter` 684 + `TabRouter` 550 +
`DrawerRouter` 238 + ~13k LOC of tests), not glue over primitives.

- **Preloaded routes** ([D6](./RFC.md#decisions): navigator-local) still must be **mounted in the `ScreenStack`** for
  scenario 2 (native pre-pushes the preview screen). The Stack render layer owns a **local preload list concatenated
  into its `ScreenStack` children** (mirrors `NativeStackView.native.tsx:466-490`); a native push **promotes** that
  local entry to a global `insertRoute(byKey)` with animation suppressed. Map `__internal__PreviewKey` → tree key.
- **Native-dismiss op table** (P4 prerequisite): map every `NativeStackView.native.tsx:509-575` callback
  (`onDismissed` w/ `dismissCount`, `onNativeDismissCancelled`, `onHeaderBackButtonClicked`, `onGestureCancel`,
  `onSheetDetentChanged`) + `usePreventRemove`/`preventNativeDismiss` veto to a lane (sync vs planner) and an op.
- **Zoom/shared-element** (`link/zoom`, `useZoomHref`) is **shipped** — carry `zoomTransitionSourceId` through the
  planner to the inserted `RouteEntry`; keep `NativeBottomTabsRouter`'s strip-zoom-on-cross-tab + no-anim-on-nested
  guards. It is **not** a deferrable "custom" animation ([N9](#n9)); do not regress it.

### N19 — Public-API compatibility matrix; correct the imperative `router` surface (general, react-native)

The plan's §2.8 router list (`navigate/goBack/goBackTo/replace/preload/reset`) **did not match** the real shipped
surface. The actual `router` is `push/navigate/replace/back/dismiss/dismissTo/dismissAll/canDismiss/setParams/reload/
prefetch/canGoBack`. Build a **keep/shim/break matrix** (with a written migration note) covering: `router.*`,
`useNavigation()` (full `NavigationProp`: `setOptions`/`addListener`/`getParent`/`getId`/`dispatch`/`getState`/
`openDrawer`), `useNavigationContainerRef`, `useRootNavigationState`, `withLayoutContext`, `usePreventRemove`,
`useFocusEffect`/`useIsFocused`, `Navigator`/`Slot`, `unstable_navigationEvents`. `goBackTo`/`preload`/`reset` are
**new** names; either alias to existing API or document the rename.

### N20 — Omitted subsystems get explicit phases (general)

These are unmentioned in the plan and must be sequenced (after the core is proven): **loaders/data** (`src/loaders`,
`useLoaderData`, `router.reload` re-run on nav/promote), **RSC** (`src/rsc`, server-tree serialization), **typed-routes**
(`Href`/`RoutePath` typegen — if `Target={path,scope}` replaces `Href`, codegen changes), **redirects/guards**
([D9](./RFC.md#decisions): `getRoutesRedirects`, `<Redirect>`, `<Protected>` — resolution-time in the planner/manifest),
**modal presentation** (`presentation:'modal'`, `dismissTo`, web modal, formSheet), **navigationEvents** + focus/blur.

### N21 — Re-sequenced phasing; smallest-first vertical slice (general, all)

**P4 cannot be one green commit** (rewriting all navigators at once violates the red/green rule). Re-sequence:

- Split **P4 into one independently-green commit per navigator, Stack first** (back-action anchor; scenarios 2/3/5 all
  hit it). **Not Tabs first** — Tabs forces the most-contested decisions (promotion/focus-order/`Activity`, N6/N10/N16).
- Insert a **"native render-layer contract"** design step before P4 (the `NavNode` → what `NativeStackView` consumes:
  descriptors, merged options, per-route `navigation`, preload list — [N17](#n17)/[N18](#n18)).
- Add the omitted-surface phases ([N20](#n20)) and the `useNavigation`/options compat shim ([N17](#n17)/[N19](#n19))
  before the full cutover.

**Smallest-first vertical slice (the first thing to build, behind the flag):** prove the model end-to-end on **Stack
only**, **JS push + JS back only** (scenarios 3 + 5), against **`apps/router-e2e/__e2e__/stack`**:
`types.ts` + `reducer.ts` (`insertRoute`/`removeRoute`/`setIndex` with the N14 structural-sharing invariant) +
`planner.ts` (`push`,`goBack` for `kind:'stack'`) + `hydrate.ts`/`project.ts` for a linear stack + a minimal `store.tsx`
+ a Stack render layer rendering `routes[0..index]`. Gate: the **N11 golden-file projection test passes first**. Defer
native-reconcile (scenario 2), preview/preload, `singular`/`getId`, Tabs, and everything in N20 to follow-ups. This
slice touches ~6–8 small files, breaks no public API (flag-gated), and proves/kills the riskiest unknown
(deferred-transition + key-relative ops, [N5](#n5)) at minimum cost.

## P1 implementation & pre-commit review outcomes

> P1 (pure core: `src/state/{types,keys,reducer,planner}.ts` + node tests) was challenged by four fresh
> agents before commit (test-coverage, test-validity, architecture, minimalism). Their findings and fixes:

- **N22 — Route keys are minted by the reducer from a per-node monotonic `seq`, not by the planner from
  `routes.length`.** The architecture review showed the original `routes.length` scheme was neither unique
  (pop-then-push reuses an ordinal) nor replay-safe (two deferred pushes off the same base collide) — which
  would have defeated the very N5 property this slice exists to prove. Fix: `insertRoute` carries `name`
  (+ optional explicit `key` for seeds/anchors); the reducer mints `key = name#seq` and bumps `seq`. A test
  asserts two pushes of the same name in one batch get distinct keys (`details#1`, `details#2`). `seq` is on
  the node ([N12](#n12) shape now `{ key, routes, index, kind, seq }`).
- **N23 — Slice trimmed to honest scope.** Removed speculative surface flagged by the minimalism review:
  `replaceRoute`, `setParams` (+ `updateRouteByKey`), `promoteChild`, `batch`-via-tabs, `setIndexToKey`,
  `focusOrder`, `makeNodeKey`, and `NodeKind 'split'|'slot'`. Kept `batch` (atomicity primitive, tested with
  stack-only ops). Each removed item returns in its own slice ([N21](#n21)).
- **N24 — `planGoBack` guards an out-of-range focused `index`** (it read `routes[index].key` unguarded — a
  real throw under a stale snapshot). Added `focusedPath`/`planGoBack` out-of-range tests.
- **Coverage/validity hardening:** added deep (>1 level) structural-sharing test, scoped `fromNodeKey` back
  (the `useLocalRouter` path, [N10](#n10)), batch-with-a-no-op-member, `at`-clamp, and an explicit
  `<=`-boundary insert test (fixtures chosen so key suffix ≠ array position where it mattered).
- **Verified:** `tsc --noEmit` clean for `src/state` (strict `noUncheckedIndexedAccess`); 3 new node suites
  pass; full expo-router Node project green (602 passed). The reducer never reads `kind` (N2 honored).
- **Note (process):** `project.ts` + the [N11](#n11) golden-file gate belong to **P2**, not P1 — P1 is the
  pure core only. The render layer (P4) is gated on that golden test, per [N21](#n21).

## P2 implementation & pre-commit review outcomes

> P2 (`hydrate` + `manifest` + `project`) was challenged by four fresh agents (coverage, validity,
> architecture, minimalism). Project.ts shipped in `a402fed`; hydrate/manifest fixes below.

- **N25 — The manifest resolves `kind` by full layout PATH and throws on an unregistered path.** Two
  fixes the architecture review forced: (a) keying by **bare route name** misresolves for name
  collisions across parents and dynamic `[id]` layouts → key by the **full layout path** (`''` = root),
  accumulated during conversion. (b) A silent `'stack'` **fallback** would mis-type a tabs node and give
  it stack back-behavior → an unregistered kind now **throws a clear error** (kind must come from static
  config, never guessed). Until navigators are tagged statically, the path→kind map is the registry.
- **N26 — Hydrate↔reducer key discipline is consistent by construction (N15/N22).** Hydrate keys routes
  by per-node position (`name#0..n-1`) and sets `seq = count`; the reducer mints `name#seq` from there.
  A seam test hydrates repeated names then pushes the same name and asserts all keys stay unique.
- **`unwrapRootSlot`:** the matcher nests under the `__root` slot; the homogeneous root is the slot's
  **content**, so we unwrap it (and re-wrap symmetrically in `project`). Verified the real matcher emits
  `__root`-wrapped state for `/details`. Both unwrap branches unit-tested.
- **Minimalism:** dropped the `Manifest` wrapper type (`createManifest` returns `ResolveKind` directly),
  un-exported `ROOT_LAYOUT`, and typed `hydrate`'s options via the real `Options` type instead of
  `Parameters<...>`.
- **Deferred (recorded, not done this slice):** `+not-found`/`_sitemap` top routes — the real matcher
  returns a `+not-found` route (not `undefined`) for unmatched paths; hydration of those is part of the
  not-found subsystem (N20). Deep multi-level nesting through the *real* matcher (vs the unit converter's
  `toEqual` nesting tests) and group/dynamic/catch-all round-trips via the matcher are coverage to add
  when the Stack render layer wires up the real linking config.
- **F5 (note for P5):** `project.ts` imports `getRouteInfoFromState` from `global-state/` (the module
  N11 deletes at cutover). It is a pure function; relocate it to a neutral module (e.g. `fork/`) during
  the P5 cutover so the new layer doesn't depend on the layer it replaces.
- **Verified:** 49 state tests pass (Node + Web); `tsc` clean; reducer still never reads `kind`.

## P3 implementation & pre-commit review outcomes

> P3 (`store.tsx`) was challenged by four fresh agents (architecture/React, coverage, validity,
> minimalism). Fixes applied:

- **N28 — The imperative bridge advances OPTIMISTICALLY on commit (refines [N13](#n13)).** The
  architecture/React review found that a post-commit-only snapshot makes **chained imperative actions
  in one tick** silently drop (two `back()`s plan against the same stale snapshot → one pop, a
  regression vs today's routing queue). Fix: `commit` applies the op to `bridge.snapshot` synchronously
  (via the pure reducer) before dispatching to React. Because the reducer is pure and the store is the
  **sole writer**, the optimistic value always equals the eventual committed state, so there is no
  tearing. So N13 is refined: the bridge mirrors the **latest intended** state (optimistic + reconciled
  post-commit), not strictly last-committed. Tests: two pushes / two backs in one `act` behave
  correctly (the two-backs test fails under a stale snapshot).
- **Coverage:** added a node-scoped `useLocalRouter` test via `NavigatorNode` (the headline N10 feature
  was previously exercised only at the root default) and the chained-action tests above.
- **Validity:** strengthened the unmount test (push first so `canGoBack` is `true`, so `false` after
  unmount can only mean the bridge was cleared) + asserted pushed params land + renamed the
  outside-provider test to call `useNavState` directly.
- **Minimalism:** dropped the always-true `defer` param + dead sync branch (the native `flushSync` lane
  re-arrives with the native layer, N5), merged the two `useLayoutEffect`s into one with cleanup, and
  extracted a shared `ROOT_NODE_KEY` (used by hydrate's root node and the node-context default) to kill
  the magic-string coupling.
- **Deferred (recorded):** per-request SSR scoping of the module bridge ([N4](#n4) — the bridge is
  client-only today; the effect doesn't run on the server), per-navigator **context slicing** (the
  whole tree is in one context value — fine for one stack, revisit for fan-out), the native
  `flushSync` sync lane, and full href **target resolution** (`resolveTarget`) for a global
  `router.push(href)` — `useLocalRouter.push(name)` is what the render layer needs first.
- **Verified:** 67 state tests pass (Node + Web); `tsc` clean; reducer still never reads `kind`;
  React 19 `use()` + no `any` (CLAUDE.md).

## Scope reality (recorded honestly)

A faithful, fully-working rewrite of **all** navigators with all native behaviors (iOS preview/zoom/split collapse,
Android predictive back/native tabs), plus loaders, RSC, typed-routes, guards, modal presentation, and the full
`useNavigation`/`withLayoutContext` compatibility surface — to a green `router-e2e` on-device — is a **multi-month,
multi-engineer effort** (~11k LOC of router behavior + ~13k LOC of tests to replace). This work proceeds as
**incremental, independently-reviewable vertical slices** ([N21](#n21)), each challenged and committed on its own,
starting from the Stack-only JS slice. Progress is measured by slices proven green under the flag, not by a single
big-bang cutover.

