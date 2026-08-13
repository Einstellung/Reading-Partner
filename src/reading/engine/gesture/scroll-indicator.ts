// Where the scroll indicator's thumb sits, and how big it is. Pure — the host
// owns the element and the fade.
//
// A self-driven scroll has no scrollbar of its own: the page divs are
// touch-action:none in every mode (docs/pitfall/37), so the scroll is ours and
// so is any hint of position that goes with it. In a three-hundred page book
// the difference between "I am scrolling" and "I am a third of the way in" is
// this one strip.
//
// It rides outside the scroll container, so the rubber band (which moves the
// container itself, docs/pitfall/45) does not drag it off the edge of the
// screen: the indicator belongs to the frame, not to the content.

// The thumb never shrinks past this, however long the document is — below it
// the strip stops reading as a position and starts reading as a speck.
export const INDICATOR_MIN_THUMB_PX = 36;
// Margin at both ends of the track, so the thumb does not touch the corners.
export const INDICATOR_TRACK_INSET_PX = 4;
// How long after the last scroll the strip fades out. Long enough to still be
// there when a fling settles, short enough not to become furniture.
export const INDICATOR_FADE_AFTER_MS = 700;

export interface ThumbMetrics {
  // px from the start of the container to the start of the thumb.
  offset: number;
  size: number;
}

// Null when there is nothing to scroll: a document that fits the screen (or a
// paged layout, where the vertical axis never moves) shows no indicator at all.
export function thumbMetrics(
  scroll: number,
  client: number,
  content: number,
  minThumb: number = INDICATOR_MIN_THUMB_PX,
  inset: number = INDICATOR_TRACK_INSET_PX,
): ThumbMetrics | null {
  const range = content - client;
  const track = client - inset * 2;
  if (range <= 1 || track <= 0) return null;
  const size = Math.min(track, Math.max(minThumb, (track * client) / content));
  const progress = Math.min(Math.max(scroll / range, 0), 1);
  return { offset: inset + (track - size) * progress, size };
}
