// shadcn/ui Popover. The same three departures the DropdownMenu carries, all
// from docs/30:
//
// - the content takes OVERLAY_SAFE.anchored, collisionPadding from
//   useOverlaySafePadding() and renders <OverlayLayer />, and sits on
//   OVERLAY_Z.anchored rather than the generated `z-50`: an anchored overlay
//   has to paint over the surface its trigger sits on, and those go well above
//   50 (docs/pitfall/103).
// - everything that renders a DOM node is a forwardRef. The generated file is
//   written for React 19, where `ref` is an ordinary prop; on React 18 the ref
//   never reaches the Radix part underneath and nothing says so
//   (docs/pitfall/95). Root and Portal stay plain: they render no DOM of their
//   own.
// - Anchor is kept. The one caller's trigger is not the thing the overlay
//   belongs to: the case is the button, and the column rises from the corner
//   the case and the body stand in together (docs/68). Without it the column
//   hangs off the case's own right edge, 40-odd pixels in from the margin the
//   corner keeps.
// - `align` defaults to "end" rather than "center". The one caller is the
//   corner companion (lumen/LumenCorner), whose column rises from the corner it
//   stands in.

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/ui/components/lib/utils"
import {
  OVERLAY_SAFE,
  OVERLAY_Z,
  OverlayLayer,
  useOverlaySafePadding,
} from "@/ui/components/ui/overlay"

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentProps<typeof PopoverPrimitive.Trigger>
>(function PopoverTrigger({ ...props }, ref) {
  return <PopoverPrimitive.Trigger ref={ref} data-slot="popover-trigger" {...props} />
})

const PopoverAnchor = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Anchor>,
  React.ComponentProps<typeof PopoverPrimitive.Anchor>
>(function PopoverAnchor({ ...props }, ref) {
  return <PopoverPrimitive.Anchor ref={ref} data-slot="popover-anchor" {...props} />
})

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentProps<typeof PopoverPrimitive.Content>
>(function PopoverContent(
  { className, align = "end", sideOffset = 8, collisionPadding, children, ...props },
  ref
) {
  const safePadding = useOverlaySafePadding()
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding ?? safePadding}
        className={cn(
          OVERLAY_Z.anchored,
          "w-72 origin-(--radix-popover-content-transform-origin) rounded-lg border bg-popover p-2 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          OVERLAY_SAFE.anchored,
          className
        )}
        {...props}
      >
        <OverlayLayer />
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
})

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
