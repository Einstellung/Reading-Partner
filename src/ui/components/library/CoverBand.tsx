// The covers on a card: one book filling the box, or up to four laid into it
// as cells (topic-shelf.ts). The box is the card — it runs to both edges, has
// no padding and no fill of its own — and it is the same shape on every card
// on the page, so a row of cards has one top and one bottom.
//
// A cover fills its cell and what does not fit is cropped from the bottom
// (`object-top`): a title and an author are in the upper half of a cover. Each
// cell answers for itself, so one slow book does not hold the others in their
// loading state.

import { COVER_BOX } from "./cardStyles";
import {
  COVER_ASPECT,
  coverGridTemplate,
  coverInitial,
  tileStyle,
  type CoverTile,
} from "./topic-shelf";
import { useCovers } from "./useCovers";

// The placeholder a book with no cover gets: its whole cell in the tinted
// second rank with the title's first letter set into the corner.
const PLACEHOLDER =
  "flex h-full w-full items-start justify-start overflow-hidden bg-secondary p-2 text-lg leading-none font-medium text-secondary-foreground";

export default function CoverBand({ tiles }: { tiles: CoverTile[] }) {
  const { covers, markFailed } = useCovers(tiles.map((t) => t.file));
  const template = coverGridTemplate(tiles.length);

  if (tiles.length === 0) {
    // A topic with no files still gets a book-shaped space, so the card reads
    // as a shelf waiting for something rather than as a broken one. Outlined
    // rather than filled: a grey fill is what a cover on its way looks like.
    return (
      <span
        className="block w-full border border-dashed border-border bg-background"
        style={{ aspectRatio: COVER_ASPECT }}
      />
    );
  }

  return (
    // The seams between cells are the grid's 1px gap with the box's own colour
    // showing through, so no cell needs a border and the outer edges stay flush
    // with the card.
    <span
      className={COVER_BOX}
      style={{
        aspectRatio: COVER_ASPECT,
        gridTemplateColumns: template.columns,
        gridTemplateRows: template.rows,
      }}
    >
      {tiles.map((tile) => {
        const path = tile.file.path;
        const url = covers[path];
        return (
          <span key={path} className="relative block overflow-hidden" style={tileStyle(tile)}>
            {url === undefined ? (
              <span className="block h-full w-full animate-pulse bg-muted" />
            ) : url === null ? (
              <span className={PLACEHOLDER}>{coverInitial(tile.file.name)}</span>
            ) : (
              <img
                src={url}
                alt=""
                className="block h-full w-full object-cover object-top"
                // A URL that will not decode is the same as no cover.
                onError={() => markFailed(path)}
              />
            )}
          </span>
        );
      })}
    </span>
  );
}
