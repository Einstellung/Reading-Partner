// One book inside a topic: its cover, the title it is shown under, where the
// reader left off, and how much of it has been marked. Same card as the shelf
// one level up, with a different label under the band.
//
// The title is cleaned for display only (file-title.ts); FileRef.name stays the
// name on disk so a card can always be traced back to its file.

import { useMemo } from "react";
import type { FileRef } from "../../../platform/app/topics";
import { CARD_LABEL, LIBRARY_CARD } from "./cardStyles";
import CardMenu from "./CardMenu";
import CoverBand from "./CoverBand";
import { displayFileTitle, readingLabel, readingProgress, type BookMeta } from "./file-title";
import { singleCoverSlot } from "./topic-shelf";

export default function BookCard(props: {
  file: FileRef;
  meta: BookMeta | undefined;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { file, meta } = props;
  const slots = useMemo(() => singleCoverSlot(file), [file]);
  const title = displayFileTitle(file.name);
  const line = readingLabel(meta);
  const progress = readingProgress(meta);

  return (
    <li className="relative">
      <button className={LIBRARY_CARD} onClick={props.onOpen}>
        <CoverBand slots={slots} />
        {/* The bar sits on the band's hairline, where a bookmark would: it is
            the same number as the page count below, at a glance. */}
        <span className="relative block h-0.5 w-full bg-muted">
          {progress !== null && (
            <span
              className="absolute top-0 left-0 block h-full bg-primary"
              style={{ width: `${progress * 100}%` }}
            />
          )}
        </span>
        <span className={CARD_LABEL}>
          <span className="block truncate text-[15px] text-foreground" title={file.name}>
            {title}
          </span>
          <span className="mt-0.5 block h-4 text-xs text-muted-foreground">{line}</span>
        </span>
      </button>

      <div className="absolute right-1 bottom-1.5">
        <CardMenu
          label={`Actions for ${title}`}
          items={[{ label: "Remove", onSelect: props.onRemove, destructive: true }]}
        />
      </div>
    </li>
  );
}
