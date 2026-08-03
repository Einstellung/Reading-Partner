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

// The covers: the front one across whatever the page edges beside it leave, and
// each edge a fixed slice of the card. A flex row, so the front cover's own
// height is the height of the whole thing and nothing has to be measured.
export const COVER_ROW = "flex w-full items-stretch";

// The label under the cover. The right padding is the menu's room: its button
// overlaps this row, and a long title must not run under it.
export const CARD_LABEL = "block px-2.5 py-2 pr-9";

// A card that makes something instead of opening it: the "+" tile at the end of
// a grid. It has no cover, so it carries its own height.
export const ADD_CARD =
  "flex min-h-[11rem] w-full cursor-pointer flex-col items-center justify-center gap-2 " +
  "rounded-lg border-2 border-dashed border-border bg-background text-muted-foreground " +
  "can-hover:hover:border-primary can-hover:hover:text-primary";

// The grid. `items-start` is what lets a card be as tall as its own cover: a
// tall book and a wide one sit side by side, each ending where it ends, rather
// than both being stretched to the tallest in the row. The column count is in
// topic-shelf.ts, which is where the numbers behind it are.
export const LIBRARY_GRID = "grid list-none m-0 p-0 items-start gap-x-4 gap-y-6";

// The page a grid sits on. The safe-area padding is the design's own gutter
// wherever there is no inset (styles.css takes the larger of the two), so this
// column never has to know which device it is on.
export const LIBRARY_PAGE = "w-[min(1180px,100%)] mx-auto pt-8 pb-safe-10 pl-safe-6 pr-safe-6";
