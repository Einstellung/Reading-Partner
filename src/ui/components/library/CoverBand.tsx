// The covers on a card: one book, a stack of three, or the outline of the book
// a topic does not have yet. Both library grids use this, so a cover looks the
// same wherever it appears.
//
// A cover is never cropped. Its box takes the width the slot gives it and the
// shape the image reports on load (topic-shelf.ts), so the hairline edge and
// the shadow are exactly the artwork — a first page is whatever shape it is,
// and cropping one to a fixed frame takes the bottom line of type off the front
// of the book. Until the image answers, the box is a book-shaped guess.

import { useState } from "react";
import { COVER_BAND } from "./cardStyles";
import {
  coverBox,
  coverInitial,
  COVER_ASPECT,
  EMPTY_SLOT_WIDTH_PERCENT,
  type CoverSlot,
} from "./topic-shelf";
import { useCovers } from "./useCovers";

// Bottom-aligned, so books stand on one line. A lone cover is centred on the
// band; a stack is placed by left edges (topic-shelf.ts).
const COVER = "absolute bottom-0 block rounded-[2px]";
const CENTRED = "-translate-x-1/2";
// The edge and the lift. Both are needed on a white first page, which is
// otherwise invisible on a white card.
const COVER_EDGE = "border border-black/10 shadow-[0_3px_8px_rgba(0,0,0,0.18)]";

export default function CoverBand({ slots }: { slots: CoverSlot[] }) {
  const { covers, markFailed } = useCovers(slots.map((s) => s.file));
  // Natural width over height, per path, once the image has loaded.
  const [ratios, setRatios] = useState<Record<string, number>>({});

  return (
    <span className={COVER_BAND}>
      <span className="relative block h-full w-full">
        {slots.length === 0 ? (
          // An empty topic still gets a book-shaped space, so the card reads as
          // a shelf waiting for something rather than as a broken one.
          <span
            className={`${COVER} ${CENTRED} left-1/2 border border-dashed border-secondary-border`}
            style={{ width: `${EMPTY_SLOT_WIDTH_PERCENT}%`, aspectRatio: COVER_ASPECT }}
          />
        ) : (
          slots.map((slot) => {
            const path = slot.file.path;
            const url = covers[path];
            const box = coverBox(slot, ratios[path]);
            const place = slot.anchor === "centre" ? `${COVER} ${CENTRED}` : COVER;
            if (url === undefined) {
              return <span key={path} className={`${place} animate-pulse bg-muted`} style={box} />;
            }
            if (url === null) {
              return (
                <span
                  key={path}
                  // The letter sits top-left, where a spine carries its title:
                  // in a stack of three only the left strip of the covers behind
                  // is visible, and a centred letter hides under the one in
                  // front of it.
                  className={`${place} ${COVER_EDGE} flex items-start justify-start bg-secondary px-2 pt-2 text-2xl leading-none font-medium text-secondary-foreground`}
                  style={box}
                >
                  {coverInitial(slot.file.name)}
                </span>
              );
            }
            return (
              <img
                key={path}
                src={url}
                alt=""
                className={`${place} ${COVER_EDGE} object-contain object-bottom`}
                style={box}
                onLoad={(e) => {
                  const { naturalWidth, naturalHeight } = e.currentTarget;
                  if (!naturalWidth || !naturalHeight) return;
                  setRatios((prev) =>
                    prev[path] ? prev : { ...prev, [path]: naturalWidth / naturalHeight },
                  );
                }}
                // A URL that will not decode is the same as no cover.
                onError={() => markFailed(path)}
              />
            );
          })
        )}
      </span>
    </span>
  );
}
