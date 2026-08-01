// Shared utility-class strings for the shell chrome (migrated from styles.css).
// Split so variant overrides never collide with base padding/border utilities.
// inline-flex + centering lets `coarse:min-h-[44px]` grow these to the 44px touch
// target with the label centered; on a fine pointer min-h is inert, so desktop
// density is unchanged.
export const BTN_BASE =
  "inline-flex items-center justify-center leading-none border rounded-md bg-white cursor-pointer enabled:hover:bg-[#f0f0f0] disabled:opacity-40 disabled:cursor-default coarse:min-h-[44px]";
export const BTN = `${BTN_BASE} text-sm px-3 py-1.5 border-[#dcdcdc]`;
export const BTN_PRIMARY =
  "inline-flex items-center justify-center text-sm leading-none px-3 py-1.5 rounded-md bg-[#6c4fd0] text-white cursor-pointer enabled:hover:bg-[#5a3fbf] disabled:opacity-40 disabled:cursor-default coarse:min-h-[44px]";
export const BTN_SM = `${BTN_BASE} text-xs px-2 py-1 border-[#dcdcdc]`;
export const BTN_SM_DANGER = `${BTN_BASE} text-xs px-2 py-1 border-[#f0c8c8] text-[#b91c1c]`;

// The 44px touch target for a control that has to stay visually small: a status
// dot, a switch track, a badge ✕, a link inside a sentence. A pseudo-element
// centred on the control carries the target — it hit-tests to the control, so
// nothing in the layout moves and a fine pointer sees no change. Sized, not
// inset: the containing block is the padding box, whose size depends on the
// engine's default button border. The element must be positioned — add
// `relative` unless it already is.
export const HIT_44 =
  "coarse:before:absolute coarse:before:top-1/2 coarse:before:left-1/2 coarse:before:h-11 coarse:before:w-11 coarse:before:-translate-x-1/2 coarse:before:-translate-y-1/2 coarse:before:content-['']";
