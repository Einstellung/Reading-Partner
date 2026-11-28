// The full-screen page both license screens stand on (docs/platform/713). A
// Radix dialog that cannot be dismissed: Escape and presses outside are
// refused, focus is trapped, and everything behind is aria-hidden. Portalled
// to <body> on purpose, unlike Settings: it covers the whole app and must not
// slide with the phone shell's back swipe. Its own rung, OVERLAY_Z.lock, sits
// above everything else the app can have open, and the dialogs opened from it
// take OVERLAY_Z.lockDialog through the surface.

import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import {
  Dialog,
  DialogDescription,
  DialogFullScreenContent,
  DialogPortal,
  DialogTitle,
} from "../ui/dialog";
import { OVERLAY_SAFE, OVERLAY_Z, OverlaySurface } from "../ui/overlay";

const refuse = (e: Event) => e.preventDefault();

export function LicensePage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <Dialog open>
      <DialogPortal>
        <OverlaySurface layer="lock">
          <DialogFullScreenContent
            className={OVERLAY_Z.lock}
            onEscapeKeyDown={refuse}
            onPointerDownOutside={refuse}
            onInteractOutside={refuse}
          >
            <div
              className={cn(
                OVERLAY_SAFE.fullscreen,
                "mx-auto flex min-h-full w-[min(420px,100%)] flex-col justify-center gap-6",
              )}
            >
              <div className="flex flex-col gap-2">
                <DialogTitle className="m-0 text-xl font-semibold">{title}</DialogTitle>
                <DialogDescription className="m-0 text-sm text-muted-foreground">
                  {body}
                </DialogDescription>
              </div>
              <div className="flex flex-col gap-3">{children}</div>
            </div>
          </DialogFullScreenContent>
        </OverlaySurface>
      </DialogPortal>
    </Dialog>
  );
}
