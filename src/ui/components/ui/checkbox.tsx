// shadcn/ui Checkbox (docs/30). The tick comes from common/icons
// because lucide-react is not a dependency here.
//
// The box stays 16px and HIT_44 carries the touch target as a centred
// pseudo-element, the same deal Switch takes: a 44px box beside a line of label
// text would be a different control. Nothing in the layout moves and a fine
// pointer sees no change.
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";

import { IconCheck } from "@/ui/components/common/icons";
import { HIT_44 } from "@/ui/components/common/buttons";
import { cn } from "@/ui/components/lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "relative size-4 shrink-0 cursor-pointer rounded-[4px] border border-input bg-background",
        "outline-none disabled:cursor-default disabled:opacity-50",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        HIT_44,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current"
      >
        <IconCheck size={12} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
