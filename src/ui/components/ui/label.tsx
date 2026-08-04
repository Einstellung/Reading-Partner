// shadcn/ui Label. A label in this app wraps its control rather than pointing at
// it by id, in one of two shapes, so the shape is the variant. The exception is
// `detached`, for the one control that cannot be a descendant
// (settings/ChoiceField).
//
// shadcn's generated Label is `font-medium leading-none select-none` — not
// adopted: the labels here are regular weight, and taking the weight up would
// reprint every settings card.
//
// forwardRef: LabelPrimitive.Root forwards its own ref to the <label>, but the
// wrapper here is what a caller hands the ref to, and on React 18 a plain
// function component drops it in silence (docs/pitfall/95).
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/ui/components/lib/utils";

const labelVariants = cva("text-sm", {
  variants: {
    layout: {
      // A checkbox or a switch and its text, on one line.
      row: "flex items-center gap-2",
      // A caption over the field it names.
      stack: "flex flex-col gap-1.5",
      // Text alone, named control elsewhere by htmlFor. The row it sits in
      // belongs to the caller.
      detached: "",
    },
  },
  defaultVariants: { layout: "row" },
});

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentProps<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(function Label({ className, layout, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      data-slot="label"
      className={cn(labelVariants({ layout, className }))}
      {...props}
    />
  );
});

export { Label, labelVariants };
