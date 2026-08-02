// shadcn/ui Collapsible. Three changes to the generated file: React is imported
// (the generated file uses React.ComponentProps without it, which the project's
// tsc rejects), the "use client" directive is dropped (no RSC here), and all
// three wrappers are forwardRefs — the generated ones are written for React 19,
// where `ref` is an ordinary prop, and on React 18 they drop it in silence
// (docs/pitfall/95). All three render a DOM node: root and content a div,
// trigger a button.
//
// Nothing from ui/overlay.tsx: a collapsible opens in flow, not through a
// portal, so it has neither a safe area of its own nor a layer to register.

import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

const Collapsible = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Root>,
  React.ComponentProps<typeof CollapsiblePrimitive.Root>
>(function Collapsible({ ...props }, ref) {
  return <CollapsiblePrimitive.Root ref={ref} data-slot="collapsible" {...props} />
})

const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleTrigger>,
  React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>
>(function CollapsibleTrigger({ ...props }, ref) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      ref={ref}
      data-slot="collapsible-trigger"
      {...props}
    />
  )
})

const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleContent>,
  React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>
>(function CollapsibleContent({ ...props }, ref) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      ref={ref}
      data-slot="collapsible-content"
      {...props}
    />
  )
})

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
