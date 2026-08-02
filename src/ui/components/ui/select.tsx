// shadcn/ui Select, trimmed to what this app uses (docs/30). Group,
// Label and Separator are gone with their call sites; the check and the chevrons
// come from common/icons because lucide-react is not a dependency here.
//
// `position="popper"` rather than the generated default: only popper publishes
// --radix-popper-available-*, which is what OVERLAY_SAFE.anchored clamps
// against, and only popper takes collisionPadding. Item-aligned would put the
// list over the trigger with neither.
//
// The trigger wears the field chrome (ui/input.tsx) so it still matches the text
// fields it sits beside, plus the 44px minimum every touch target in this app
// keeps.
import { Select as SelectPrimitive } from "radix-ui";
import type * as React from "react";

import { IconCheck, IconChevronDown, IconChevronUp } from "@/ui/components/common/icons";
import { cn } from "@/ui/components/lib/utils";
import { OVERLAY_SAFE, OverlayLayer, useOverlaySafePadding } from "@/ui/components/ui/overlay";
import { fieldClassName } from "@/ui/components/ui/input";

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        fieldClassName,
        "flex items-center justify-between gap-2 coarse:min-h-[44px]",
        "cursor-pointer text-left disabled:cursor-default disabled:opacity-50",
        "data-[placeholder]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <span className="flex-none text-[#555]">
          <IconChevronDown size={16} />
        </span>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position="popper"
        sideOffset={4}
        collisionPadding={useOverlaySafePadding()}
        className={cn(
          OVERLAY_SAFE.anchored,
          "relative z-50 min-w-[var(--radix-select-trigger-width)] overflow-x-hidden overflow-y-auto",
          "rounded-lg border border-black/10 bg-popover p-1 text-popover-foreground shadow-lg",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="w-full">{children}</SelectPrimitive.Viewport>
        <SelectScrollDownButton />
        <OverlayLayer />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

// A row keeps the menu geometry of docs/30's third pass: 36px resting, 44px
// under a coarse pointer, highlight left to Radix's own focus.
function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2 rounded-md py-0 pr-8 pl-2.5",
        "min-h-[36px] coarse:min-h-[44px] text-left text-sm coarse:text-base text-[#333]",
        "outline-hidden select-none focus:bg-accent focus:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex items-center justify-center text-primary">
        <SelectPrimitive.ItemIndicator>
          <IconCheck size={16} />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn("flex cursor-default items-center justify-center py-1 text-[#555]", className)}
      {...props}
    >
      <IconChevronUp size={16} />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn("flex cursor-default items-center justify-center py-1 text-[#555]", className)}
      {...props}
    >
      <IconChevronDown size={16} />
    </SelectPrimitive.ScrollDownButton>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
