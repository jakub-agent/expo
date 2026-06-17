// The manifest resolves a node's `kind` (stack | tabs) from static config, by the hosting layout's
// PATH, without a mounted component (C12 option A / N1).
//
// A layout's navigator kind is decided by which navigator its `_layout` renders, which is NOT in the
// static route tree today (`RouteNode.type` lacks it — the N1 prerequisite). Until navigators are
// tagged statically (their own slice), kind is supplied through this small path → kind map that
// navigators populate; hydrate and the planner read it by path (N25 in Decisions.md).
//
// Keyed by full layout PATH ('' = root), NOT bare route name: two layouts named `home` under
// different parents, or dynamic `[id]` layouts, must resolve distinctly. An unregistered path
// THROWS rather than guessing — a wrong kind would give a tabs navigator stack back-behavior.

import type { NodeKind } from './types';

/** Resolve the kind of the navigator hosted at a layout path ('' = the root layout). */
export type ResolveKind = (hostPath: string) => NodeKind;

/** Build a kind resolver from a path → kind map. Throws for an unregistered layout path. */
export function createManifest(kinds: Record<string, NodeKind>): ResolveKind {
  return (hostPath) => {
    const kind = kinds[hostPath];
    if (!kind) {
      throw new Error(
        `No navigator kind registered for layout "${hostPath || '(root)'}". A node's kind ` +
          `(stack | tabs) must come from static config; it cannot be guessed because the wrong kind ` +
          `gives a navigator the wrong back behavior. Register this layout's kind before hydrating.`
      );
    }
    return kind;
  };
}
