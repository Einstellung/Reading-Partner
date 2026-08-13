// The menu on a library card: rename, delete, remove — the things that used to
// be buttons sitting in a row, which is most of why the row was a row.
//
// It sits at the end of the label strip rather than on the cover, and carries
// no fill of its own: on a card whose subject is a book cover, a white pill
// floating over the artwork reads as something that got in by mistake. The
// glyph is small and the target is the 44px the button size table gives it,
// which is taller than the strip and reaches up over the bottom of the cover —
// invisibly, since the button has no fill. It stays visible under a finger (no
// `can-hover:` gating), because a touch screen has no hover to reveal it.

import { useRef, useState } from "react";
import { IconChevronDown } from "../common/icons";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export interface CardMenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

export default function CardMenu({ label, items }: { label: string; items: CardMenuItem[] }) {
  const [open, setOpen] = useState(false);
  // Whether the menu was up when the press started. Radix opens on pointerdown,
  // and a row clicks itself on a pointerup it never saw a pointerdown for, so
  // one tap can both open the menu and pick the row under the finger
  // (docs/pitfall/83). Opening on click keeps that tap out of the menu; closing
  // still goes through the dismiss layer, which fires on pointerdown and has
  // already run by the time the click arrives — hence the state from before it.
  const wasOpen = useRef(false);

  return (
    // modal={false}: the grid stays scrollable while the menu is up, and `body`
    // keeps its pointer events, which is what a dialog opened from a row has to
    // survive.
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground can-hover:hover:bg-muted"
          aria-label={label}
          title={label}
          onPointerDown={(e) => {
            wasOpen.current = open;
            e.preventDefault();
          }}
          onClick={() => setOpen(!wasOpen.current)}
        >
          <IconChevronDown size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            className={item.destructive ? "text-destructive focus:text-destructive" : undefined}
            onSelect={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
