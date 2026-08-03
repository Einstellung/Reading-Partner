// The covers on a card. The front one is the card: it runs to both edges and
// the card is as tall as it is. The other books in a topic stand to its right
// as page edges, which is the whole of what is left of the stack — a cover
// pulled back into the middle of a frame is what this replaced.
//
// A cover is never cropped to a shape someone else chose. The box takes the
// shape the image reports on load (topic-shelf.ts); until then it holds a
// book-shaped space so the grid does not jump when the image arrives.

import { useState, type SyntheticEvent } from "react";
import { COVER_ROW } from "./cardStyles";
import {
  coverAspect,
  coverInitial,
  frontWidthPercent,
  stackFiles,
  type CoverStack,
} from "./topic-shelf";
import { useCovers } from "./useCovers";

// The placeholder a book with no cover gets: the whole card in the tinted
// second rank with the title's first letter set into the corner, not a small
// book shape floating in a bigger box.
const PLACEHOLDER =
  "flex h-full w-full items-start justify-start bg-secondary p-2.5 text-xl leading-none font-medium text-secondary-foreground";

export default function CoverBand({ stack }: { stack: CoverStack | null }) {
  const { covers, markFailed } = useCovers(stackFiles(stack));
  // Natural width over height, per path, once the image has loaded.
  const [ratios, setRatios] = useState<Record<string, number>>({});

  if (!stack) {
    // A topic with no files still gets a book-shaped space, so the card reads
    // as a shelf waiting for something rather than as a broken one. Outlined
    // rather than filled: a grey fill is what a cover on its way looks like.
    return (
      <span
        className="block w-full border border-dashed border-border bg-background"
        style={{ aspectRatio: coverAspect(undefined) }}
      />
    );
  }

  const front = stack.front.path;
  const frontUrl = covers[front];

  const onLoad = (path: string) => (e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (!naturalWidth || !naturalHeight) return;
    setRatios((prev) => (prev[path] ? prev : { ...prev, [path]: naturalWidth / naturalHeight }));
  };

  return (
    <span className={COVER_ROW}>
      {/* The front cover. Its aspect ratio is what gives the row its height,
          which is why the page edges beside it need no height of their own. */}
      <span
        className="relative block"
        style={{
          width: `${frontWidthPercent(stack)}%`,
          aspectRatio: coverAspect(ratios[front]),
        }}
      >
        {frontUrl === undefined ? (
          <span className="block h-full w-full animate-pulse bg-muted" />
        ) : frontUrl === null ? (
          <span className={PLACEHOLDER}>{coverInitial(stack.front.name)}</span>
        ) : (
          <img
            src={frontUrl}
            alt=""
            className="block h-full w-full object-cover"
            onLoad={onLoad(front)}
            // A URL that will not decode is the same as no cover.
            onError={() => markFailed(front)}
          />
        )}
      </span>

      {stack.spines.map((file) => {
        const url = covers[file.path];
        return (
          <span
            key={file.path}
            className="relative block self-stretch border-l border-black/10"
            style={{ width: `${stack.spineWidthPercent}%` }}
          >
            {url === undefined ? (
              <span className="block h-full w-full animate-pulse bg-muted" />
            ) : url === null ? (
              <span className="block h-full w-full bg-secondary" />
            ) : (
              // The left edge of that book's cover, which is the part of it a
              // book standing behind another one shows.
              <img
                src={url}
                alt=""
                className="block h-full w-full object-cover object-left"
                onError={() => markFailed(file.path)}
              />
            )}
          </span>
        );
      })}
    </span>
  );
}
