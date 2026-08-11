// shadcn/ui Tabs, trimmed to what this app has (docs/30). Changes to the
// generated file:
//
// - every trigger ends in `coarse:min-h-[44px]`, like the button sizes. shadcn
//   ships a 36px list with `h-[calc(100%-1px)]` triggers, which is under the
//   touch target and cannot grow past the list's own height.
// - hover is behind `can-hover:`, so a tap never leaves one stuck on.
// - the `dark:` half of every string is gone: this app has no dark theme, and a
//   token it never defines is a rule that can only fire by accident.
// - the `line` variant and its `group-data-[orientation=*]` styling are gone
//   with it. Layout is the caller's, in breakpoints: the settings page puts the
//   list beside the panel on a wide screen and above it on a narrow one, which
//   `data-orientation` cannot express because it is a prop and not a media
//   query.
// - the content is `min-h-0`, so a caller can make it the scrolling half of a
//   fixed-height column. Without it the flex item refuses to shrink below its
//   content and the whole page scrolls, list included.
// - forwardRef, like every wrapper here: on React 18 a plain function component
//   drops a ref in silence (docs/pitfall/95).

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/ui/components/lib/utils"

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentProps<typeof TabsPrimitive.Root>
>(function Tabs({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Root
      ref={ref}
      data-slot="tabs"
      className={cn("flex gap-2", className)}
      {...props}
    />
  )
})

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentProps<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="tabs-list"
      className={cn(
        "flex items-center justify-center gap-1 rounded-lg bg-muted p-[3px] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
})

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentProps<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex min-h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors coarse:min-h-[44px] can-hover:hover:text-foreground disabled:cursor-default disabled:opacity-40 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className
      )}
      {...props}
    />
  )
})

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentProps<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      data-slot="tabs-content"
      className={cn("min-h-0 flex-1 outline-none", className)}
      {...props}
    />
  )
})

export { Tabs, TabsContent, TabsList, TabsTrigger }
