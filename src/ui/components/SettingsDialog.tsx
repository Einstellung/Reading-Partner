// Settings where there is no shell to put the page in: the phone, whose stack
// pushes it over the screen it came from, and the reader, which has a top bar
// instead of a sidebar (docs/51). Same body as the page, in a full-screen
// dialog with a title bar and a Done.
//
// The shell mounts and unmounts it, so `open` is constant and onOpenChange only
// ever reports the close Radix decides on — Escape. What the dialog buys is the
// focus trap, an aria-hidden screen behind, and that Escape.
//
// One scroller: DialogFullScreenContent has it, so nothing inside is fixed and
// the title bar scrolls away with the cards (docs/pitfall/88 — there is no
// scroll lock to fight over either).

import { cn } from "./lib/utils";
import { SettingsBody, type SettingsBodyProps } from "./SettingsView";
import { Button } from "./ui/button";
import { Dialog, DialogFullScreenContent, DialogTitle } from "./ui/dialog";
import { OVERLAY_SAFE } from "./ui/overlay";

export default function SettingsDialog({
  onClose,
  ...body
}: SettingsBodyProps & { onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogFullScreenContent aria-describedby={undefined}>
        {/* The page is fixed, so the shell's safe-area padding does not reach
            it and the title row would sit under the notch (docs/pitfall/74).
            OVERLAY_SAFE.fullscreen is that inset, on the column rather than on
            the page, so the white still runs to the edge of the screen. */}
        <div
          className={cn(OVERLAY_SAFE.fullscreen, "mx-auto flex w-[min(860px,100%)] flex-col")}
        >
          {/* A title bar rather than a title and a stray button: the rule under
              it is what makes Done belong to the heading it sits a page-width
              away from. */}
          <div className="mb-6 flex shrink-0 items-center justify-between border-b border-border pb-4">
            {/* The classes belong on DialogTitle, not on the <h1>: asChild
                merges the two className strings by concatenating them, so a
                class written on the child does not displace the default it
                contradicts — it only races it in the stylesheet. On DialogTitle
                they go through cn() and the default is gone. */}
            <DialogTitle asChild className="m-0 font-display text-[22px] leading-normal font-semibold">
              <h1>Settings</h1>
            </DialogTitle>
            <Button type="button" variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>

          <SettingsBody {...body} />
        </div>
      </DialogFullScreenContent>
    </Dialog>
  );
}
