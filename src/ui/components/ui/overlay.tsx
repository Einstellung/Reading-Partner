// The two things every portalled overlay in this directory needs, in one place.
//
// Safe area. Radix mounts an overlay under <body>, not inside the shell's
// `p-safe` container, so it gets none of that padding and can land under the
// notch or the home indicator (docs/pitfall/74). The env() itself stays in
// styles.css; what is chosen here is which recipe a given shape of overlay uses.
//
// Layer registration. The app's own dismiss-on-outside-press overlays cannot see
// a portalled subtree as "inside" them, so a layer announces itself instead
// (common/overlay-layer).
//
// A content component in this directory does both:
//
//   className={cn(OVERLAY_SAFE.centered, "...", className)}
//
// and renders <OverlayLayer /> among its children, so that registration mounts
// and unmounts with the portalled content rather than with the trigger.
//
// An anchored one takes a third thing, useOverlaySafePadding(), because half of
// its clamping is Radix's and Radix's half is JS.
//
// One shape is not portalled — the full-screen page, which has to stay inside
// the phone shell's sliding surface (ui/dialog.tsx). It still takes both of the
// above: it is still fixed, so the shell's padding still misses it, and a press
// on it still has to stop belonging to whatever is underneath.

import { useEffect, useMemo, useState } from "react";

import { pushOverlayLayer } from "@/ui/components/common/overlay-layer";
import {
  measureSafeAreaInsets,
  NO_SAFE_AREA,
  safeCollisionPadding,
  sameInsets,
  type SafeAreaInsets,
} from "@/ui/components/common/safe-area";

export const OVERLAY_SAFE = {
  // Centred in the viewport: AlertDialog and Dialog.
  centered: "overlay-safe",
  // Pinned to the bottom edge: the toast viewport. An edge-pinned overlay only
  // needs the axis it is pinned to; its own max width keeps it off the sides.
  bottom: "bottom-safe-6",
  // Covering the whole app: Settings, and whatever the fifth pass makes a page.
  // Nothing is clamped, because the overlay is the viewport — what needs the
  // insets is the column of content inside it, so this goes on that column and
  // not on the page box. Keeping the box itself full-bleed is what lets its
  // background reach the edges of the screen behind the notch while the text
  // stays clear of it. max() rather than sum, for the reason in styles.css: the
  // page's own margin has to survive a device that reports no inset, and where
  // there is one it has already cleared the notch.
  fullscreen: "pt-safe-10 pr-safe-6 pb-safe-10 pl-safe-6",
  // Anchored to a trigger: DropdownMenu, and Popover / Select later. This is
  // only the size half of the recipe — the position half is collisionPadding,
  // see useOverlaySafePadding. An anchored box moves rather than shrinks, so
  // the clamp that matters is Radix's, and it publishes what it worked out as
  // --radix-popper-available-*: the room left on the chosen side once the
  // collision padding is taken off. Capping the box at that turns the one case
  // shifting cannot fix — a box larger than the space it has — into a scroll
  // inside the box. The popper-level custom properties rather than the
  // per-component aliases, so the same string serves every popper overlay.
  anchored:
    "max-w-(--radix-popper-available-width) max-h-(--radix-popper-available-height)",
} as const;

// The viewport margin an anchored overlay keeps, as the number Radix's
// collisionPadding wants. Remeasured on resize (a rotation changes which edge
// carries the inset); the identity check keeps a resize from re-rendering an
// open overlay for nothing.
export function useOverlaySafePadding(): SafeAreaInsets {
  const [insets, setInsets] = useState<SafeAreaInsets>(NO_SAFE_AREA);

  useEffect(() => {
    const read = () =>
      setInsets((current) => {
        const next = measureSafeAreaInsets();
        return sameInsets(current, next) ? current : next;
      });
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);

  return useMemo(() => safeCollisionPadding(insets), [insets]);
}

export function OverlayLayer() {
  useEffect(pushOverlayLayer, []);
  return null;
}
