// The chrome both library grids wear: the topics shelf and the books inside one
// topic are the same card with a different label under it, and these strings are
// where that sameness lives.
//
// The card is the cover. No padding around it, no fill behind it and no frame
// on it — the artwork runs to all four edges of the card and the shadow is what
// separates one book from the next. Everything else is the strip of text under
// it, which is as tall as two lines of type and no taller.

export const LIBRARY_CARD =
  "block w-full cursor-pointer overflow-hidden rounded-lg bg-background p-0 text-left " +
  "shadow-[0_1px_4px_rgba(0,0,0,0.14)] can-hover:hover:shadow-[0_2px_10px_rgba(0,0,0,0.20)]";

// The covers: one grid cell each, with a 1px gap that shows the box's own
// colour as a seam. The shape is fixed (topic-shelf.ts) and set at the call
// site, because it is what makes every card on the page the same size.
//
// The hairline round the outside is the same line as the seams, and it is what
// a white first page needs: a scanned page on a white card with nothing round
// it reads as an empty cell rather than as a book.
export const COVER_BOX = "grid w-full gap-px border border-border bg-border";

// The label under the cover. Fixed height, so a card is a fixed size whatever
// its title and whatever the line under it says — two lines of type at their
// own leading, and 8px above and below. The right padding is the menu's room:
// its button overlaps this row, and a long title must not run under it.
export const CARD_LABEL = "block h-[50px] overflow-hidden px-2.5 py-2 pr-9";
export const CARD_TITLE = "block truncate text-[13px] leading-[18px] font-medium text-foreground";
export const CARD_META = "mt-0.5 block truncate text-[11px] leading-[14px] text-muted-foreground";

// A card that makes something instead of opening it: the "+" tile at the end of
// a grid. It is built from the same two pieces as a card — a box of the cover's
// shape and a label strip — so it is exactly the size of the cards beside it
// whether it shares their row or sits on one of its own.
export const ADD_CARD =
  "flex w-full cursor-pointer flex-col rounded-lg border-2 border-dashed border-border " +
  "bg-background text-muted-foreground can-hover:hover:border-primary can-hover:hover:text-primary";
export const ADD_CARD_BOX = "flex w-full aspect-[3/4] flex-col items-center justify-center gap-2";

// The grid. Every card is the same size — one cover shape and one label height —
// so rows line up without anything being stretched to fit. The column count is
// in topic-shelf.ts, which is where the numbers behind it are.
export const LIBRARY_GRID = "grid list-none m-0 p-0 gap-x-4 gap-y-6";

// The page a grid sits on. The safe-area padding is the design's own gutter
// wherever there is no inset (styles.css takes the larger of the two), so this
// column never has to know which device it is on.
export const LIBRARY_PAGE = "w-[min(1180px,100%)] mx-auto pt-8 pb-safe-10 pl-safe-6 pr-safe-6";
