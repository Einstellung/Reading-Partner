// shadcn/ui Slider, taken apart (docs/30). Changes to the generated file:
//
// - the four Radix parts are exported one by one instead of one Slider that
//   renders a track, a range and a thumb per value. The phone's Display sheet
//   draws tick marks inside the track and keeps the track clear of the thumb's
//   half-width at both ends, and the generated component has nowhere to put
//   either.
// - the root keeps `touch-none` and `select-none`: a drag along the track is the
//   slider's, not the page's and not the sheet's.
// - the thumb has no hover ring: hover is not a state a finger leaves behind.
// - every part is a forwardRef. On React 18 a plain function component drops a
//   ref in silence (docs/pitfall/95).

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/ui/components/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentProps<typeof SliderPrimitive.Root>
>(function Slider({ className, ...props }, ref) {
  return (
    <SliderPrimitive.Root
      ref={ref}
      data-slot="slider"
      className={cn(
        "relative flex w-full cursor-pointer touch-none items-center select-none data-[disabled]:cursor-default data-[disabled]:opacity-40",
        className
      )}
      {...props}
    />
  )
})

const SliderTrack = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Track>,
  React.ComponentProps<typeof SliderPrimitive.Track>
>(function SliderTrack({ className, ...props }, ref) {
  return (
    <SliderPrimitive.Track
      ref={ref}
      data-slot="slider-track"
      className={cn("relative h-1.5 grow rounded-full bg-muted", className)}
      {...props}
    />
  )
})

const SliderRange = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Range>,
  React.ComponentProps<typeof SliderPrimitive.Range>
>(function SliderRange({ className, ...props }, ref) {
  return (
    <SliderPrimitive.Range
      ref={ref}
      data-slot="slider-range"
      className={cn("absolute h-full rounded-full bg-primary", className)}
      {...props}
    />
  )
})

const SliderThumb = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Thumb>,
  React.ComponentProps<typeof SliderPrimitive.Thumb>
>(function SliderThumb({ className, ...props }, ref) {
  return (
    <SliderPrimitive.Thumb
      ref={ref}
      data-slot="slider-thumb"
      className={cn(
        "block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
        className
      )}
      {...props}
    />
  )
})

export { Slider, SliderRange, SliderThumb, SliderTrack }
