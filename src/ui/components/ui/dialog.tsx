// shadcn/ui Dialog. Four changes to the generated file, all from docs/30:
//
// - the centred content takes OVERLAY_SAFE.centered and renders <OverlayLayer />,
//   the two things everything portalled out of this directory has to do
//   (ui/overlay.tsx). The generated `z-50` is gone from both contents and the
//   overlay: the layer comes from the scale, so a caller never invents one, and
//   which rung of it comes from the surface the dialog was opened from — a
//   dialog opened from one of the hand-placed floaters has to cover that floater
//   (useDialogLayer, docs/pitfall/208). The full-screen page is the exception:
//   it is a surface in its own right and names its own rung.
// - the width is the caller's, and it is a `w-*`. max-width belongs to the
//   safe-area utility alone — two of them at equal specificity would be settled
//   by the order Tailwind happens to emit them in. The generated `sm:max-w-lg`
//   is gone rather than turned into `sm:w-*`: a width behind a breakpoint that a
//   caller forgets to restate keeps winning above that breakpoint, because
//   tailwind-merge only replaces an identical modifier chain (docs/pitfall/78).
// - the generated corner close button is gone. It is the only thing in the file
//   that wanted lucide-react, which this project does not install, and both
//   dialogs here already carry their own Done / Close.
// - DialogFullScreenContent is added, for a page that covers the app rather than
//   a box floating over it. Its three departures are argued at the component.
// - every wrapper that renders a DOM node is a forwardRef. The generated file is
//   written for React 19, where `ref` is an ordinary prop; on React 18 the ref
//   never reaches the Radix part underneath and nothing says so
//   (docs/pitfall/95). Dialog and DialogPortal stay plain: they render no DOM.

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/ui/components/lib/utils"
import { OVERLAY_SAFE, OVERLAY_Z, OverlayLayer, useDialogLayer } from "@/ui/components/ui/overlay"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

const DialogTrigger = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Trigger>,
  React.ComponentProps<typeof DialogPrimitive.Trigger>
>(function DialogTrigger({ ...props }, ref) {
  return <DialogPrimitive.Trigger ref={ref} data-slot="dialog-trigger" {...props} />
})

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

const DialogClose = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Close>,
  React.ComponentProps<typeof DialogPrimitive.Close>
>(function DialogClose({ ...props }, ref) {
  return <DialogPrimitive.Close ref={ref} data-slot="dialog-close" {...props} />
})

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentProps<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  // The backdrop asks the surface itself instead of taking the content's layer
  // as a prop: the two are siblings under the portal, and a dim sheet on a lower
  // rung than the box it dims is the same bug one step smaller.
  const layer = useDialogLayer()
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        layer,
        className
      )}
      {...props}
    />
  )
})

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentProps<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, ...props }, ref) {
  const layer = useDialogLayer()
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          layer,
          OVERLAY_SAFE.centered,
          className
        )}
        {...props}
      >
        <OverlayLayer />
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})

// A dialog that is the whole screen rather than a box on top of it. Three
// departures from the centred one, none of them cosmetic:
//
// - not portalled. The phone shell moves its entire surface under the left-edge
//   back swipe, and a `position: fixed` child follows only while it is a
//   descendant of the transformed element (useEdgeBack, docs/pitfall/41). A
//   portalled copy would sit outside that subtree: it would stay put while the
//   screen behind it slid, and the gesture's own capture listeners — which are
//   on the surface — would never see the presses that start on it. Rendering in
//   place also keeps the DOM position this page already had.
// - no DialogOverlay, and so no scroll lock. Radix keeps RemoveScroll on the
//   overlay, not on the content; a page that covers the viewport and carries its
//   own scroller has nothing underneath left to scroll, and skipping it leaves
//   `body` with nothing on it but the pointer-events the modal layer sets and
//   takes back. There is nothing to dim either — the page is opaque.
// - its own layer, OVERLAY_Z.page rather than the dialog one. It is opaque and
//   covers the viewport, so it has to clear the app, and the call site used to
//   raise it by hand — which put it over the anchored overlays opened from
//   inside it (docs/pitfall/103). The layer belongs to the shape, not to the
//   page that happens to use it.
// - no clamp. `overlay-safe` sizes a box that floats in the viewport; this one
//   is the viewport, and its background has to reach the edges of the screen
//   behind the notch. The insets pad the content column instead, which is what
//   OVERLAY_SAFE.fullscreen is for and what the page applies to its own column.
//
// modal stays true: what it is wanted for here is the focus trap, aria-hidden on
// everything behind, and Escape.
const DialogFullScreenContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentProps<typeof DialogPrimitive.Content>
>(function DialogFullScreenContent({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Content
      ref={ref}
      data-slot="dialog-full-screen-content"
      className={cn(
        "fixed inset-0 overflow-y-auto bg-background outline-none",
        OVERLAY_Z.page,
        className
      )}
      {...props}
    >
      <OverlayLayer />
      {children}
    </DialogPrimitive.Content>
  )
})

const DialogHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  function DialogHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="dialog-header"
        className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
        {...props}
      />
    )
  }
)

const DialogFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  function DialogFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="dialog-footer"
        className={cn(
          "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
          className
        )}
        {...props}
      />
    )
  }
)

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentProps<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
})

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentProps<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
})

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFullScreenContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
