// shadcn/ui Badge with the two pills this app actually draws, not shadcn's six.
// The `source` one appeared verbatim in six files and in two shades of purple;
// one string ends that. Non-interactive, so there is no touch target and no
// hover state here.
//
// forwardRef anyway: a pill is measured often enough, and React 18 drops a ref
// handed to a plain function component without a word (docs/pitfall/95).
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/ui/components/lib/utils";

// A plain inline box, not shadcn's inline-flex: the pills here hold one string,
// and an inline-flex would change how they sit on the line of a call site that
// is not itself a flex row.
const badgeVariants = cva("rounded-full px-2 py-0.5 text-[11px] font-medium", {
  variants: {
    variant: {
      // Where a piece of news came from.
      source: "bg-[#f0eefb] text-primary",
      // A briefing item outside the topics the user asked for.
      aside: "bg-[#f2e4c4] text-[#8a6d1f]",
    },
  },
  defaultVariants: { variant: "source" },
});

const Badge = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>
>(function Badge({ className, variant, ...props }, ref) {
  return (
    <span
      ref={ref}
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
});

export { Badge, badgeVariants };
