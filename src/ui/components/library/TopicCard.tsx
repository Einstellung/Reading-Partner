// One topic on the shelf: the cover of the book it was last read against, the
// other books as page edges beside it, its name and how many files it holds.
// Nothing else — reading position, marks and last-opened all belong to a book,
// not to the question the books are read against, and a grid of numbers stops
// being a shelf.
//
// The ordering, the widths and the labels are in topic-shelf.ts; this file
// renders them and binds the events.

import { useMemo } from "react";
import type { Topic } from "../../../platform/app/topics";
import { CARD_LABEL, LIBRARY_CARD } from "./cardStyles";
import CardMenu from "./CardMenu";
import CoverBand from "./CoverBand";
import { coverStack, fileCountLabel } from "./topic-shelf";

export default function TopicCard(props: {
  topic: Topic;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { topic } = props;
  const stack = useMemo(() => coverStack(topic), [topic]);

  return (
    <li className="relative">
      <button className={LIBRARY_CARD} onClick={props.onOpen}>
        <CoverBand stack={stack} />
        <span className={CARD_LABEL}>
          <span className="block truncate text-[13px] font-medium text-foreground">
            {topic.name}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {fileCountLabel(topic.files.length)}
          </span>
        </span>
      </button>

      {/* Outside the card's button rather than inside it: a button inside a
          button is neither valid nor clickable. It sits over the label strip,
          whose right padding is its room; the target is 44px and reaches up
          over the bottom of the cover, the glyph is small. */}
      <div className="absolute right-0 bottom-0">
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
