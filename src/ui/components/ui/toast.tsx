// Radix Toast, styled as the hand-written stack it replaces. shadcn's own
// wrapper is Sonner now, which brings its own store, its own injected stylesheet
// and its own stacking geometry; the markup here is the app's, so the box, the
// stack and the 44px close target are the ones that were already shipping
// (docs/30).
//
// What Radix adds: the countdown (paused while the pointer is over the stack and
// while the window is not focused), a live region announcement, swipe to
// dismiss, and F8 to move focus into the stack.

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { Toast as ToastPrimitive } from "radix-ui";

import { cn } from "@/ui/components/lib/utils";
import { OVERLAY_SAFE } from "@/ui/components/ui/overlay";

const ToastProvider = ToastPrimitive.Provider;

// The viewport is an <ol> rendered where it is mounted rather than portalled,
// but it is `fixed` and so is outside the shell's padding all the same — the
// safe area comes from the shared recipe (docs/pitfall/74).
function ToastViewport({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2",
        OVERLAY_SAFE.bottom,
        className,
      )}
      {...props}
    />
  );
}

const toastVariants = cva(
  "pointer-events-auto flex max-w-[420px] items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-md data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none",
  {
    variants: {
      kind: {
        warn: "border-amber-300 bg-amber-50 text-amber-800",
        error: "border-red-300 bg-red-50 text-red-800",
      },
    },
    defaultVariants: { kind: "warn" },
  },
);

function Toast({
  className,
  kind,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> &
  VariantProps<typeof toastVariants>) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(toastVariants({ kind }), className)}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("flex-1", className)}
      {...props}
    />
  );
}

// The touch target is the button's own box, not a pseudo-element: there is room
// beside the message for a 44px square.
function ToastClose({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Close>) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      className={cn(
        "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center opacity-60 can-hover:hover:opacity-100 coarse:h-11 coarse:w-11",
        className,
      )}
      {...props}
    />
  );
}

export { Toast, ToastClose, ToastDescription, ToastProvider, ToastViewport };
