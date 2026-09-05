// shadcn/ui AlertDialog. Two changes to the generated file, both from docs/30:
//
// - the content takes OVERLAY_SAFE.centered and renders <OverlayLayer />, which
//   is how anything Radix portals to <body> gets the safe area and announces
//   itself to the app's own click-outside overlays (ui/overlay.tsx). The
//   generated `z-50` goes with it: the layer comes from the scale, and which
//   rung of that scale comes from the surface the dialog was opened from — a
//   confirm opened from the call bubble has to cover the bubble
//   (docs/pitfall/211).
// - the width is stated with `w-*` rather than `max-w-*`, so that max-width
//   belongs to the safe-area utility alone. Two max-widths at equal specificity
//   would be settled by the order Tailwind happens to emit them in.
// - everything that renders a DOM node is a forwardRef. The generated file is
//   written for React 19, where `ref` is an ordinary prop; on React 18 the ref
//   never reaches the Radix part underneath and nothing says so
//   (docs/pitfall/95). Root and Portal stay plain: they render no DOM.

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "@/ui/components/lib/utils"
import { Button } from "@/ui/components/ui/button"
import { OVERLAY_SAFE, OverlayLayer, useDialogLayer } from "@/ui/components/ui/overlay"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

const AlertDialogTrigger = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Trigger>,
  React.ComponentProps<typeof AlertDialogPrimitive.Trigger>
>(function AlertDialogTrigger({ ...props }, ref) {
  return (
    <AlertDialogPrimitive.Trigger
      ref={ref}
      data-slot="alert-dialog-trigger"
      {...props}
    />
  )
})

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentProps<typeof AlertDialogPrimitive.Overlay>
>(function AlertDialogOverlay({ className, ...props }, ref) {
  // The backdrop asks the surface itself instead of taking the content's layer
  // as a prop. The two are siblings under the portal, and a dim sheet left on a
  // lower rung than the box it dims is the same bug one step smaller.
  const layer = useDialogLayer()
  return (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        layer,
        className
      )}
      {...props}
    />
  )
})

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
    size?: "default" | "sm"
  }
>(function AlertDialogContent(
  { className, size = "default", children, ...props },
  ref
) {
  const layer = useDialogLayer()
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "group/alert-dialog-content fixed top-[50%] left-[50%] grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 data-[size=sm]:w-80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[size=default]:sm:w-[32rem]",
          layer,
          OVERLAY_SAFE.centered,
          className
        )}
        {...props}
      >
        <OverlayLayer />
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  )
})

const AlertDialogHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(function AlertDialogHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
})

const AlertDialogFooter = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(function AlertDialogFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
})

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentProps<typeof AlertDialogPrimitive.Title>
>(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Title
      ref={ref}
      data-slot="alert-dialog-title"
      className={cn(
        "text-lg font-semibold sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
})

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentProps<typeof AlertDialogPrimitive.Description>
>(function AlertDialogDescription({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Description
      ref={ref}
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
})

const AlertDialogMedia = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(function AlertDialogMedia({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-16 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-8",
        className
      )}
      {...props}
    />
  )
})

// The ref goes on the Radix part, not on Button: Button is the one wearing
// asChild, so what it renders is this child, and Slot merges the two refs onto
// it either way.
const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentProps<typeof AlertDialogPrimitive.Action> &
    Pick<React.ComponentProps<typeof Button>, "variant" | "size">
>(function AlertDialogAction(
  { className, variant = "default", size = "default", ...props },
  ref
) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Action
        ref={ref}
        data-slot="alert-dialog-action"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
})

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
    Pick<React.ComponentProps<typeof Button>, "variant" | "size">
>(function AlertDialogCancel(
  { className, variant = "outline", size = "default", ...props },
  ref
) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Cancel
        ref={ref}
        data-slot="alert-dialog-cancel"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
})

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
