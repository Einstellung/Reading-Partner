// One book inside a topic: its cover, the title it is shown under, who wrote it,
// where the reader left off, and how much of it has been marked. Same card as
// the shelf one level up, with a different label under the cover.
//
// The title is cleaned for display only (file-title.ts); FileRef.name stays the
// name on disk so a card can always be traced back to its file. The author is
// the PDF's own metadata, read on the same open as the cover.

import { useMemo } from "react";
import { useT } from "../../../i18n";
import type { FileRef } from "../../../platform/app/topics";
import {
  BOOK_AUTHOR,
  BOOK_LABEL,
  BOOK_PROGRESS,
  BOOK_PROGRESS_FILL,
  BOOK_READ,
  BOOK_TITLE,
  LIBRARY_CARD,
} from "./cardStyles";
import CardMenu from "./CardMenu";
import CoverBand from "./CoverBand";
import { displayFileTitle, readingLabel, readingProgress, type BookMeta } from "./file-title";
import { singleCoverTile } from "./topic-shelf";
import { useBookAuthor } from "./useCovers";

export default function BookCard(props: {
  file: FileRef;
  meta: BookMeta | undefined;
  onOpen: () => void;
  // Start a retell of this book (docs/31). Absent for a file that has never
  // been opened: it has no book id yet, so there is nothing on disk to retell.
  onRetell?: () => void;
  // File it under another topic. Absent when there is nowhere to move it to
  // (shelf/move-to.ts canMoveFile).
  onMove?: () => void;
  // Delete it, with everything about it.
  onRemove: () => void;
}) {
  const t = useT();
  const { file, meta } = props;
  const tiles = useMemo(() => singleCoverTile(file), [file]);
  const title = displayFileTitle(file.name);
  const author = useBookAuthor(file);
  const line = readingLabel(meta);
  const progress = readingProgress(meta);

  return (
    <li className="relative">
      <button className={LIBRARY_CARD} onClick={props.onOpen}>
        <CoverBand tiles={tiles} />
        <span className={BOOK_LABEL}>
          <span className={BOOK_TITLE} title={file.name}>
            {title}
          </span>
          {/* Always rendered, empty or not: the row keeps its height so the bar
              at the bottom of every card sits on the same line. */}
          <span className={BOOK_AUTHOR}>{author ?? ""}</span>
          <span className={BOOK_READ}>{line}</span>
          <span className={BOOK_PROGRESS}>
            <span
              className={BOOK_PROGRESS_FILL}
              style={{ width: `${(progress ?? 0) * 100}%` }}
            />
          </span>
        </span>
      </button>

      <div className="absolute right-0 bottom-0">
        <CardMenu
          label={t("library.card.actionsFor", { name: title })}
          items={[
            ...(props.onRetell
              ? [{ label: t("library.card.retell"), onSelect: props.onRetell }]
              : []),
            ...(props.onMove ? [{ label: t("library.move.action"), onSelect: props.onMove }] : []),
            { label: t("library.card.delete"), onSelect: props.onRemove, destructive: true },
          ]}
        />
      </div>
    </li>
  );
}
