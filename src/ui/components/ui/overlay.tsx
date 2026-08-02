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

import { useEffect } from "react";

import { pushOverlayLayer } from "@/ui/components/common/overlay-layer";

export const OVERLAY_SAFE = {
  // Centred in the viewport: AlertDialog, and Dialog in the fourth pass.
  centered: "overlay-safe",
  // Pinned to the bottom edge: the toast viewport. An edge-pinned overlay only
  // needs the axis it is pinned to; its own max width keeps it off the sides.
  bottom: "bottom-safe-6",
} as const;

export function OverlayLayer() {
  useEffect(pushOverlayLayer, []);
  return null;
}
