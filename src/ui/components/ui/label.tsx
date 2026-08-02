// shadcn/ui Label. Every label in this app wraps its control rather than
// pointing at it by id, in one of two shapes, so the shape is the variant.
//
// shadcn's generated Label is `font-medium leading-none select-none` — not
// adopted: the labels here are regular weight, and taking the weight up would
// reprint every settings card.
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/ui/components/lib/utils";

const labelVariants = cva("text-sm", {
  variants: {
    layout: {
      // A checkbox or a switch and its text, on one line.
      row: "flex items-center gap-2",
      // A caption over the field it names.
      stack: "flex flex-col gap-1.5",
    },
  },
  defaultVariants: { layout: "row" },
});

function Label({
  className,
  layout,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(labelVariants({ layout, className }))}
      {...props}
    />
  );
}

export { Label, labelVariants };
