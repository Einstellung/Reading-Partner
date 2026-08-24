// One book inside a topic: its cover, the title it is shown under, where the
// reader left off, and how much of it has been marked. Same card as the shelf
// one level up, with a different label under the cover.
//
// The title is cleaned for display only (file-title.ts); FileRef.name stays the
// name on disk so a card can always be traced back to its file.

import { useMemo } from "react";
import type { FileRef } from "../../../platform/app/topics";
import { CARD_LABEL, CARD_META, CARD_TITLE, LIBRARY_CARD } from "./cardStyles";
import CardMenu from "./CardMenu";
import CoverBand from "./CoverBand";
import { displayFileTitle, readingLabel, readingProgress, type BookMeta } from "./file-title";
import { singleCoverTile } from "./topic-shelf";

export default function BookCard(props: {
  file: FileRef;
  meta: BookMeta | undefined;
  onOpen: () => void;
  // Start a talk about this book (docs/31). Absent for a file that has never
  // been opened: it has no book id yet, so there is nothing on disk to retell.
  onRetell?: () => void;
  onRemove: () => void;
}) {
  const { file, meta } = props;
  const tiles = useMemo(() => singleCoverTile(file), [file]);
  const title = displayFileTitle(file.name);
  const line = readingLabel(meta);
  const progress = readingProgress(meta);

  return (
    <li className="relative">
      <button className={LIBRARY_CARD} onClick={props.onOpen}>
        <span className="relative block">
          <CoverBand tiles={tiles} />
          {/* On the cover's bottom edge, where a bookmark would be, rather than
              on a line of its own: the cover owns the whole width of the card. */}
          {progress !== null && (
            <span className="absolute inset-x-0 bottom-0 block h-[3px] bg-black/15">
              <span
                className="absolute top-0 left-0 block h-full bg-primary"
                style={{ width: `${progress * 100}%` }}
              />
            </span>
          )}
        </span>
        <span className={CARD_LABEL}>
          <span className={CARD_TITLE} title={file.name}>
            {title}
          </span>
          <span className={CARD_META}>{line}</span>
        </span>
      </button>

      <div className="absolute right-0 bottom-0">
        <CardMenu
          label={`Actions for ${title}`}
          items={[
            ...(props.onRetell
              ? [{ label: "Retell this book…", onSelect: props.onRetell }]
              : []),
            { label: "Remove", onSelect: props.onRemove, destructive: true },
          ]}
        />
      </div>
    </li>
  );
}
