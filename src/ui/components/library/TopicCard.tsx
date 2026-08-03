// One topic on the shelf: the covers of the books it was most recently read
// against, its name and how many files it holds. Nothing else — reading
// position, marks and last-opened all belong to a book, not to the question the
// books are read against, and a grid of numbers stops being a shelf.
//
// The ordering, the cells and the labels are in topic-shelf.ts; this file
// renders them and binds the events.

import { useMemo } from "react";
import type { Topic } from "../../../platform/app/topics";
import { CARD_LABEL, CARD_META, CARD_TITLE, LIBRARY_CARD } from "./cardStyles";
import CardMenu from "./CardMenu";
import CoverBand from "./CoverBand";
import { coverTiles, fileCountLabel } from "./topic-shelf";

export default function TopicCard(props: {
  topic: Topic;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { topic } = props;
  const tiles = useMemo(() => coverTiles(topic), [topic]);

  return (
    <li className="relative">
      <button className={LIBRARY_CARD} onClick={props.onOpen}>
        <CoverBand tiles={tiles} />
        <span className={CARD_LABEL}>
          <span className={CARD_TITLE}>{topic.name}</span>
          <span className={CARD_META}>{fileCountLabel(topic.files.length)}</span>
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
