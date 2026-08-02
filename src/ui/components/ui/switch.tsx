// shadcn/ui Switch at the size the app already drew: a 36×20 track with a 16px
// thumb. shadcn's own is 32×18 and lays the thumb out with flex; this keeps the
// absolute placement so the two rest positions stay where they were.
//
// The track stays 20px tall — it reads as a switch, not as a 44px slab — so
// HIT_44 carries the touch target as a centred pseudo-element instead.
import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";

import { HIT_44 } from "@/ui/components/common/buttons";
import { cn } from "@/ui/components/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 flex-none cursor-pointer rounded-full transition-colors",
        // The off track is the app's own grey, not a palette step: neutral-300
        // is an oklch value that lands a shade lighter.
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-[#d4d4d4]",
        HIT_44,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none absolute top-0.5 block h-4 w-4 rounded-full bg-background transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
