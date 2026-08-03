// One topic on the shelf: the covers of its three most recently read books, its
// name, and how many files it holds. Nothing else — reading position, marks and
// last-opened all belong to a book, not to the question the books are read
// against, and a grid of numbers stops being a shelf.
//
// The geometry, the ordering and the labels are in topic-shelf.ts; this file
// renders them and binds the events.

import { useMemo } from "react";
import type { Topic } from "../../../platform/app/topics";
import { CARD_LABEL, LIBRARY_CARD } from "./cardStyles";
import CardMenu from "./CardMenu";
import CoverBand from "./CoverBand";
import { coverSlots, fileCountLabel } from "./topic-shelf";

export default function TopicCard(props: {
  topic: Topic;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { topic } = props;
  const slots = useMemo(() => coverSlots(topic), [topic]);

  return (
    <li className="relative">
      <button className={LIBRARY_CARD} onClick={props.onOpen}>
        <CoverBand slots={slots} />
        <span className={CARD_LABEL}>
          <span className="block truncate text-[15px] text-foreground">{topic.name}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {fileCountLabel(topic.files.length)}
          </span>
        </span>
      </button>

      {/* Outside the card's button rather than inside it: a button inside a
          button is neither valid nor clickable. */}
      <div className="absolute right-1 bottom-1.5">
        <CardMenu
          label={`Actions for ${topic.name}`}
          items={[
            { label: "Rename", onSelect: props.onRename },
            // The confirmation is a dialog the screen owns: a menu row cannot be
            // its trigger, because picking the row closes the menu and would
            // take the dialog down with it.
            { label: "Delete", onSelect: props.onDelete, destructive: true },
          ]}
        />
      </div>
    </li>
  );
}
