// shadcn/ui Button, with the variant and size tables rewritten from the buttons
// this app already had rather than shadcn's defaults (docs/30). Three rules the
// generated version does not carry:
//
// - every size that grows with its content ends in `coarse:min-h-[44px]`, and
//   every fixed-size one in `coarse:h-11 coarse:w-11`. shadcn ships 32/36/40px,
//   which is under the touch target. It belongs here and not at the call sites,
//   which is where it used to be repeated.
// - `size="link"` carries the 44px target as HIT_44's centred pseudo-element
//   instead, because a text link inside a sentence cannot grow (docs/pitfall/75).
// - hover fills are behind `can-hover:`, so a tap never leaves one stuck on.
// - it is a forwardRef. The generated file is written for React 19, where `ref`
//   is an ordinary prop; on React 18 a plain function component drops it and
//   says nothing in a production build (docs/pitfall/95).

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { HIT_44 } from "@/ui/components/common/buttons";
import { cn } from "@/ui/components/lib/utils";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 disabled:cursor-default disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      // Colour and border only. Anything about size lives in `size`, so the two
      // compose: the same purple is a settings button and an info CTA.
      variant: {
        // The filled primary. The transparent border is load-bearing: it sits
        // next to `outline` buttons, which are 1px larger without it.
        default:
          "border border-transparent bg-primary text-primary-foreground can-hover:enabled:hover:bg-primary-hover",
        // The filled primary as info uses it: no border, heavier label.
        cta: "bg-primary font-medium text-primary-foreground can-hover:enabled:hover:bg-primary-hover",
        // The workhorse: bordered, on a white fill.
        outline: "border border-border bg-background can-hover:enabled:hover:bg-muted",
        // Bordered but unfilled, with a quieter label. What info's chips are.
        subtle:
          "border border-border bg-transparent text-muted-foreground can-hover:enabled:hover:bg-muted",
        // The violet-tinted second rank.
        secondary:
          "border border-secondary-border bg-secondary text-secondary-foreground can-hover:enabled:hover:bg-secondary-hover",
        "destructive-outline":
          "border border-destructive-border bg-background text-destructive can-hover:enabled:hover:bg-muted",
        // Filled red. The second pass adds it for AlertDialog's action, the one
        // place a destructive act is the main button of a dialog rather than an
        // inline second press.
        destructive:
          "border border-transparent bg-destructive text-destructive-foreground can-hover:enabled:hover:bg-destructive-hover",
        // No `enabled:` here, unlike the variants above: these are overridden
        // with a different fill often enough that the modifier chain has to be
        // the one a call site would write, or tailwind-merge keeps both and the
        // more specific selector wins.
        ghost: "border-0 bg-transparent can-hover:hover:bg-accent",
        // Colour stays at the call site: these read as links in running text and
        // take the colour of whatever they sit in.
        link: "border-0 bg-transparent",
      },
      // Geometry only.
      size: {
        default: "rounded-md px-3 py-1.5 text-sm leading-none coarse:min-h-[44px]",
        sm: "rounded-md px-2 py-1 text-xs leading-none coarse:min-h-[44px]",
        // The reader panels' 11px controls.
        xs: "rounded-sm px-1.5 py-0.5 text-[11px] leading-none coarse:min-h-[44px] coarse:px-2.5 coarse:py-2",
        // info's inline chips.
        chip: "rounded-lg px-2.5 py-1 text-[13px] coarse:min-h-[44px]",
        // info's calls to action and the buttons on the home cards.
        lg: "rounded-lg px-4 py-2 text-[14px] coarse:min-h-[44px]",
        icon: "h-8 w-8 rounded-md coarse:h-11 coarse:w-11",
        link: `relative p-0 coarse:px-2 coarse:py-1.5 ${HIT_44}`,
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

// Under `asChild` the ref goes to Slot, which merges it with whatever ref the
// replaced child already carries, so it still lands on that child's DOM node.
const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & { asChild?: boolean }
>(function Button({ className, variant, size, asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});

export { Button, buttonVariants };
