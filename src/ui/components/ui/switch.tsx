// shadcn/ui Switch at the size the app already drew: a 36×20 track with a 16px
// thumb. shadcn's own is 32×18 and lays the thumb out with flex; this keeps the
// absolute placement so the two rest positions stay where they were.
//
// The track stays 20px tall — it reads as a switch, not as a 44px slab — so
// HIT_44 carries the touch target as a centred pseudo-element instead.
//
// forwardRef, like every wrapper here: React 18 drops a ref given to a plain
// function component and warns only in a development build (docs/pitfall/95).
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { HIT_44 } from "@/ui/components/common/buttons";
import { cn } from "@/ui/components/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentProps<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
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
});

export { Switch };
