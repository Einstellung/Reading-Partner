// shadcn/ui Separator.
//
// The orientation rules are written as data-attribute variants, so overriding
// one from a call site takes the same form: a plain `h-5` loses to
// `data-[orientation=vertical]:h-full`, which is the more specific selector.
// Pass `data-[orientation=vertical]:h-5` instead.
//
// forwardRef, like every wrapper here: React 18 drops a ref given to a plain
// function component and warns only in a development build (docs/pitfall/95).
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as React from "react";

import { cn } from "@/ui/components/lib/utils";

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentProps<typeof SeparatorPrimitive.Root>
>(function Separator(
  { className, orientation = "horizontal", decorative = true, ...props },
  ref,
) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
});

export { Separator };
