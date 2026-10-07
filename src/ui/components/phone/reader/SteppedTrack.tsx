// One row of the Display sheet (docs/70): a ladder of a few rungs drawn as a
// track with a tick per rung, between two buttons whose icons say what the two
// ends of it are. Text size, line spacing and margins are all this row.
//
// The track is a Radix slider (ui/slider.tsx), so the drag, the arrow keys and
// the slider role come from there; the rung is its value and the rung's name is
// what a screen reader hears. The track is inset by half a thumb at each end,
// which is where Radix keeps the thumb's centre at the first and last value, so
// the ticks, the filled range and the thumb all meet on the same points.

import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Slider, SliderRange, SliderThumb, SliderTrack } from "../../ui/slider";
import { stepFromEnd, stepFromSlider, tickFraction } from "./stepped-track";

export interface TrackEnd {
  icon: ReactNode;
  label: string;
}

export default function SteppedTrack(props: {
  label: string;
  count: number;
  index: number;
  valueText: (index: number) => string;
  start: TrackEnd;
  end: TrackEnd;
  onStep: (index: number) => void;
}) {
  const { count, index, onStep } = props;
  const go = (next: number) => {
    if (next !== index) onStep(next);
  };
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="flex-none rounded-full text-foreground"
        aria-label={props.start.label}
        onClick={() => go(stepFromEnd(index, count, "start"))}
      >
        {props.start.icon}
      </Button>
      <Slider
        className="h-8 flex-1 coarse:h-11"
        min={0}
        max={count - 1}
        step={1}
        value={[index]}
        onValueChange={(values) => go(stepFromSlider(values, count))}
      >
        <SliderTrack className="mx-[11px] h-[3px] bg-muted-strong">
          <SliderRange className="bg-foreground" />
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "absolute top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full",
                i <= index ? "bg-foreground" : "bg-muted-foreground/45",
              )}
              style={{ left: `${tickFraction(i, count) * 100}%` }}
            />
          ))}
        </SliderTrack>
        <SliderThumb
          className="size-[22px] border-[1.5px] border-foreground bg-background shadow-[0_1px_3px_rgb(0_0_0/0.2)]"
          aria-label={props.label}
          aria-valuetext={props.valueText(index)}
        />
      </Slider>
      <Button
        variant="ghost"
        size="icon"
        className="flex-none rounded-full text-foreground"
        aria-label={props.end.label}
        onClick={() => go(stepFromEnd(index, count, "end"))}
      >
        {props.end.icon}
      </Button>
    </div>
  );
}
