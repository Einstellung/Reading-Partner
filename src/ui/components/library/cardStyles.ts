// The chrome both library grids wear: the topics shelf and the books inside one
// topic are the same card with a different label under it, and these strings are
// where that sameness lives.

// The card itself. No fill behind the covers and no shadow on the card: the
// books carry the shadow, the card is just the edge around them.
export const LIBRARY_CARD =
  "block w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-background p-0 text-left " +
  "can-hover:hover:border-secondary-border";

// The band the covers stand in. 4:5, so a single cover can be most of the card
// wide and still whole; no bottom padding, so the books stand on the hairline
// that separates them from the label rather than floating above it.
export const COVER_BAND = "relative block aspect-[4/5] w-full border-b border-border px-4 pt-4";

// The label under the band. The right padding is the corner menu's room: it
// overlaps this row, and a long title must not run under it.
export const CARD_LABEL = "block px-3 py-2.5 pr-11";

// A card that makes something instead of opening it: the "+" tile at the end of
// a grid. `h-full` takes the height of the row it is in, and the minimum is what
// keeps it card-shaped on a row of its own.
export const ADD_CARD =
  "flex h-full min-h-[16rem] w-full cursor-pointer flex-col items-center justify-center gap-2 " +
  "rounded-xl border-2 border-dashed border-border bg-background text-muted-foreground " +
  "can-hover:hover:border-primary can-hover:hover:text-primary";

// The grid. The column count is in topic-shelf.ts, which is where the numbers
// behind it are; this is everything else about it.
export const LIBRARY_GRID = "grid list-none m-0 p-0 gap-x-5 gap-y-8";

// The page a grid sits on. The safe-area padding is the design's own gutter
// wherever there is no inset (styles.css takes the larger of the two), so this
// column never has to know which device it is on.
export const LIBRARY_PAGE =
  "w-[min(1180px,100%)] mx-auto pt-8 pb-safe-10 pl-safe-6 pr-safe-6";
