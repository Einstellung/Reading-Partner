// The 44px touch target for a control that has to stay visually small: a status
// dot, a switch track, a badge ✕, a link inside a sentence. A pseudo-element
// centred on the control carries the target — it hit-tests to the control, so
// nothing in the layout moves and a fine pointer sees no change. Sized, not
// inset: the containing block is the padding box, and any padding or border the
// control declares would shrink an inset target. The element must be positioned
// — add `relative` unless it already is.
//
// Button's `size="link"` and Switch build it in; everywhere else it is applied
// by hand, because the control is not a Button.
export const HIT_44 =
  "coarse:before:absolute coarse:before:top-1/2 coarse:before:left-1/2 coarse:before:h-11 coarse:before:w-11 coarse:before:-translate-x-1/2 coarse:before:-translate-y-1/2 coarse:before:content-['']";
