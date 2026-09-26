// The small menu a hold opens next to the held thing (hold-menu.ts). The mark
// popup's look (PhoneReader.tsx MarkPopup): one rounded box, red items with the
// trash icon. Anchored on the held element's box, below it when there is room
// and above it when there is not.
//
// A faint scrim takes the next press: it closes the menu. The click iOS still
// sends for that tap, onto the card under it once the scrim is gone, is
// swallowed by the hold's guard (use-hold.ts); so the scrim must sit inside
// the hold's host.

import { IconTrash } from "../base/icons";
import { Button } from "../ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import type { HoldChoice, HoldMenuItem } from "./hold-menu";
import type { Held } from "./use-hold";

export default function HoldMenu(props: {
  held: Held | null;
  head: string;
  // Null while the facts that pick the items are being read.
  items: HoldMenuItem[] | null;
  onPick: (choice: HoldChoice) => void;
  onDismiss: () => void;
}) {
  const { held, items } = props;
  if (!held) return null;
  return (
    <>
      {/* Under the held element (data-held raises it over this) and over the
          rest of the screen it is on. Below the toast and dialog rungs of
          OVERLAY_Z: it belongs to the screen, not to the app. */}
      <div
        aria-hidden
        className="fixed inset-0 z-20 bg-foreground/5"
        onPointerDown={(e) => {
          e.preventDefault();
          props.onDismiss();
        }}
      />
      <Popover open={items !== null} onOpenChange={(open) => !open && props.onDismiss()}>
        <PopoverAnchor asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed"
            style={{
              left: held.rect.left,
              top: held.rect.top,
              width: held.rect.width,
              height: held.rect.height,
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          side="bottom"
          align="center"
          role="menu"
          className="w-auto min-w-[212px] rounded-xl p-1 shadow-lg"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-1 max-w-[260px] truncate border-b border-border-subtle px-3 pt-2 pb-1.5 text-[12px] text-faint-foreground">
            {props.head}
          </div>
          {(items ?? []).map((item) => (
            <Button
              key={item.choice}
              role="menuitem"
              variant="ghost"
              size="lg"
              className="w-full justify-start gap-2.5 px-3 text-[15px] text-destructive"
              onClick={() => props.onPick(item.choice)}
            >
              <IconTrash size={16} />
              {item.label}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
    </>
  );
}

// What a holdable card or row carries, for the press, the held highlight and
// the fade out (use-hold.ts sets the attributes). Spelled out once so every
// list reads the same.
export const HOLDABLE =
  "select-none [-webkit-touch-callout:none] transition-[transform,opacity,box-shadow] duration-300 ease-out data-pressing:scale-[0.96] data-pressing:delay-100 data-held:relative data-held:z-21 data-held:scale-[1.02] data-held:ring-2 data-held:ring-accent-line data-held:shadow-lg data-leaving:scale-90 data-leaving:opacity-0 data-leaving:duration-150";

// A row rather than a card: it is highlighted without growing.
export const HOLDABLE_ROW =
  "select-none [-webkit-touch-callout:none] transition-[opacity,box-shadow] duration-200 data-held:relative data-held:z-21 data-held:bg-card data-held:ring-2 data-held:ring-accent-line data-leaving:opacity-0";
