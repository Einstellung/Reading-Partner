// One topic on the shelf: a stack of its covers, its name, how many files it
// holds, and a corner menu with the two things that used to sit in the row
// (rename, delete). Nothing else goes on the card — reading position, marks and
// last-opened all belong to a book, not to the question the books are read
// against, and a grid of numbers stops being a shelf.
//
// The geometry, the ordering and the labels are in topic-shelf.ts; this file
// renders them and binds the events.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Topic } from "../../../platform/app/topics";
import { IconChevronDown } from "../common/icons";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { coverUrl } from "./cover-source";
import { coverInitial, coverSlots, fileCountLabel } from "./topic-shelf";

// A cover that has not answered yet is absent from the map; null is an answer
// (this book has no cover) and a string is the image.
type Covers = Record<string, string | null>;

const CARD =
  "block w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-background p-0 text-left " +
  "can-hover:hover:border-secondary-border";

// The shelf: a 4:3 band the covers stand on, inset so a cover never touches the
// card's border. The inner span is what the percentages in topic-shelf.ts are
// of, and it is `relative` so a cover positions against it rather than against
// the card.
const SHELF = "relative block aspect-[4/3] w-full overflow-hidden bg-muted p-4";

// A cover: bottom-aligned, so books of one height stand on one line. Width and
// centre come from the slot; the height follows from the aspect ratio, which is
// why nothing here has to know the card's pixel size.
const COVER =
  "absolute bottom-0 block aspect-[3/4] -translate-x-1/2 overflow-hidden rounded-[3px] " +
  "border border-black/10 shadow-[-2px_0_6px_rgba(0,0,0,0.10)]";

// The menu row's geometry, the same one the reader's overflow menu uses: 13px,
// 36px tall and 44px under a finger, with no padding of its own so the minimum
// is what decides the height.
const ROW =
  "w-full rounded-md px-2.5 py-0 text-left text-[13px] min-h-[36px] coarse:min-h-[44px] cursor-pointer";

export default function TopicCard(props: {
  topic: Topic;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { topic } = props;
  const slots = useMemo(() => coverSlots(topic), [topic]);
  const [covers, setCovers] = useState<Covers>({});
  const [menuOpen, setMenuOpen] = useState(false);
  // Whether the menu was up when the press started. Radix opens on pointerdown,
  // and a row clicks itself on a pointerup it never saw a pointerdown for, so
  // one tap can both open the menu and pick the row under the finger
  // (docs/pitfall/83). Opening on click keeps that tap out of the menu; closing
  // still goes through the dismiss layer, which fires on pointerdown and has
  // already run by the time the click arrives — hence the state from before it.
  const wasOpen = useRef(false);

  // One request per cover rather than one Promise.all: a slow book must not
  // hold the others in their loading state. The map is cleared first so a card
  // reused for another topic never shows the previous topic's covers.
  useEffect(() => {
    let cancelled = false;
    setCovers({});
    for (const slot of slots) {
      void coverUrl(slot.file)
        .catch(() => null)
        .then((url) => {
          if (!cancelled) setCovers((prev) => ({ ...prev, [slot.file.path]: url }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [slots]);

  return (
    <li className="relative">
      <button className={CARD} onClick={props.onOpen}>
        <span className={SHELF}>
          <span className="relative block h-full w-full">
            {slots.length === 0 ? (
              // An empty topic still gets a book-shaped space, so the card reads
              // as a shelf waiting for something rather than as a broken one.
              <span className="absolute bottom-0 left-1/2 block aspect-[3/4] w-1/2 -translate-x-1/2 rounded-[3px] border border-dashed border-secondary-border bg-background/60" />
            ) : (
              slots.map((slot) => {
                const url = covers[slot.file.path];
                return (
                  <span
                    key={slot.file.path}
                    className={COVER}
                    style={{
                      left: `${slot.leftPercent}%`,
                      width: `${slot.widthPercent}%`,
                      zIndex: slot.z,
                    }}
                  >
                    {url === undefined ? (
                      <span className="block h-full w-full animate-pulse bg-border" />
                    ) : url === null ? (
                      // The letter sits top-left, where a spine carries its
                      // title: in a stack of three only the left strip of the
                      // back covers is visible, and a centred letter hides
                      // under the cover in front of it.
                      <span className="flex h-full w-full items-start justify-start bg-secondary px-1.5 pt-1.5 text-lg leading-none font-medium text-secondary-foreground">
                        {coverInitial(slot.file.name)}
                      </span>
                    ) : (
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover"
                        // A URL that will not decode is the same as no cover.
                        onError={() =>
                          setCovers((prev) => ({ ...prev, [slot.file.path]: null }))
                        }
                      />
                    )}
                  </span>
                );
              })
            )}
          </span>
        </span>
        <span className="block px-3 py-2.5">
          <span className="block truncate text-[15px] text-foreground">{topic.name}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {fileCountLabel(topic.files.length)}
          </span>
        </span>
      </button>

      {/* Outside the card's button rather than inside it: a button inside a
          button is neither valid nor clickable. modal={false} keeps the grid
          scrollable while the menu is up and keeps `pointer-events: none` off
          body, which is what a dialog opened from a menu row has to survive. */}
      <div className="absolute top-1.5 right-1.5">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="bg-background/85 text-muted-foreground can-hover:hover:bg-background"
              aria-label={`Actions for ${topic.name}`}
              title="Rename or delete"
              onPointerDown={(e) => {
                wasOpen.current = menuOpen;
                e.preventDefault();
              }}
              onClick={() => setMenuOpen(!wasOpen.current)}
            >
              <IconChevronDown size={18} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className={ROW} onSelect={props.onRename}>
              Rename
            </DropdownMenuItem>
            {/* The confirmation is a separate dialog the card owns: a menu row
                cannot be its trigger, because picking the row closes the menu
                and would take the dialog down with it. */}
            <DropdownMenuItem
              className={`${ROW} text-destructive focus:text-destructive`}
              onSelect={props.onDelete}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
