// What a kind needs of the machine that runs it (docs/55).
//
// A capability is a tag for something about the machine — it can render a page
// in a hidden webview, it is never turned off, it has a GPU. Kinds are
// registered with the tags they need, devices declare the tags they have, and
// the election (elect.ts) only considers devices that have all of them.
//
// Tags rather than a list of kind names on each device: a kind is added by the
// domain that owns it, and a device that has never heard of that kind still
// answers correctly about whether it could run it. Nothing has to be taught the
// kind list twice, and an old build's claim does not have to be rewritten when
// a new kind appears.
//
// Registration is programmatic, like the desk's kinds and the distillation
// sources': the domain registers at startup. There is no file, so nothing has
// to be migrated when a kind's needs change.

/** Renders a page in a hidden webview (platform/app/platform.ts). */
export const WEBVIEW_FETCH = "webview-fetch";

const needs = new Map<string, readonly string[]>();

/**
 * Declare what a kind needs. Registering a kind twice replaces what it needed,
 * so a module registered again on a reload is not an error.
 */
export function registerKindCapabilities(kind: string, requires: readonly string[] = []): void {
  needs.set(kind, [...requires]);
}

/**
 * What a kind needs, or null when nobody has registered it. Null is not the
 * same as needing nothing: legion only knows the kinds a domain declared, and a
 * kind nobody declared has no machine that may run it.
 */
export function capabilitiesFor(kind: string): readonly string[] | null {
  return needs.get(kind) ?? null;
}
