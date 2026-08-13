# Recorded scenario baseline

What `scripts/ios-sim.sh gesture <name>` produces on a known-good tree, so the
next run has something to diff against. Everything here is a real measurement
taken through the bridge, not a description of the intended behaviour.

Rig: iPad Pro 11-inch (M5), iOS 26.5, `bun tauri ios dev`, touches injected
through idb's HID channel (docs/pitfall/118 for what this rig can and cannot
produce).

## How to reproduce

Run them in this order from a fresh `scripts/ios-sim.sh reader`. The scenarios
are not independent: each one leaves the layout, zoom and scroll position it
finished with, and the next one's `setup` starts from there.

```
scripts/ios-sim.sh up
scripts/ios-sim.sh reader
scripts/ios-sim.sh gesture vertical-top
scripts/ios-sim.sh gesture vertical-bottom
scripts/ios-sim.sh gesture ink-finger
scripts/ios-sim.sh gesture ink-finger-horizontal
scripts/ios-sim.sh gesture paged-flip
scripts/ios-sim.sh gesture pinch out 2.0
scripts/ios-sim.sh gesture webkit-claim 0.6 4 native
```

## The five reader scenarios

Taken at 8a5ced7 and again at 03981e6 (the tree that had moved the touch
router into `src/reading/engine/gesture/`). Both columns are the same run
order. The fields are from `window.__rec.brief()`.

| scenario | pointercancel | scrollTop | scrollLeft | container transform peak | svg paths | selection chars |
|---|---|---|---|---|---|---|
| vertical-top | none | 0 -> 0 | 0 -> 0 | 90px | 0 | 0 |
| vertical-bottom | none | 14086 -> 14086 | 0 -> 0 | 90px | 0 | 0 |
| ink-finger | none | 3268 -> 3753..3756 | 0 -> 0 | none | 0 | 0 |
| ink-finger-horizontal | none | 3268 -> 3268 | 0 -> 0 | none | 0 | 0 |
| paged-flip | none | 0 -> 0 | +844 per flip | none | 0 | 0 |

Every one of them is `pointerdown -> pointermove... -> pointerup` with no
`pointercancel`, which is what docs/pitfall/117 says the reader's own surface
does: its page boxes are `touch-action: none`, so WebKit's scroll arbitration
never gets a say.

What each row is worth checking for:

- vertical-top and vertical-bottom: the rubber band reaches 90px and the
  container scroll does not move, at both ends. A band that stops short, or a
  scrollTop that changes, is the regression.
- ink-finger: the finger scrolls (~480px for this drag) and leaves nothing
  behind — `svgPaths` stays 0 for every sampled frame, `saves` 0, annotation
  count 1, selection empty. The transient stroke docs/pitfall/37 warns about
  would show up as a non-zero `svgPaths` max even though the last frame is 0.
- ink-finger-horizontal: the sideways drag commits as neither a scroll nor a
  stroke. scrollTop and scrollLeft both unchanged, `svgPaths` 0.
- paged-flip: one swipe advances scrollLeft by 844, one page width. The
  starting scrollLeft is not stable — `setup`'s `navigateToPage(2)` sometimes
  has not reached the DOM when the recorder starts, so the row reads either
  0 -> 844 or 1688 -> 2533. The delta is the measurement; the origin is not.

`ink-finger`'s end scrollTop varies by about 15px between runs. Anything inside
3740-3760 is the same result.

## pinch

`gesture pinch out|in <scale>` through the XCUITest driver. Two real contacts,
and the zoom the engine settles on:

| argument | maxTouches | pointerIds | downs/ups | pointercancel | zoom after | selection chars |
|---|---|---|---|---|---|---|
| out 2.0 | 2 | 2 | 2/2 | 0 | 5.77 | 0 |
| out 3.0 | 2 | 2 | 2/2 | 0 | 8.57 | 0 |
| in 0.5 | 2 | 2 | 2/2 | 0 | 0.68 | 0 |

Zoom before each is 1.362, the fit-page zoom this document opens at. The
invariant docs/pitfall/38 is about holds: the two fingers doing the zooming
drag no text along, `selChars` 0.

A pinch leaves state behind. Run `ink-finger` straight after one and the finger
no longer scrolls (3268 -> 3268), while `vertical-top` and `paged-flip` still
behave. A `scripts/ios-sim.sh reader` reload clears it. This is not new — it
measures the same on 8a5ced7 and on 03981e6 — but it means a pinch has to be
the last scenario in a batch, or the ones after it need a reload first.

## webkit-claim

docs/pitfall/117 holds the tables this scenario was written for. Re-measuring
them on the same commit they were recorded on does not reproduce the numbers
exactly: the takeover boundary jitters by up to 8px between runs, and the
threshold that first loses the sequence moved from between 10 and 20 to between
20 and 24. Read 117's numbers as a band, not as values to diff against.

What is stable, and what a diff should be against:

| condition | outcome |
|---|---|
| native, any step size | `pointercancel`, no `pointerup`, container scrolls 670-771px |
| native | first `touchmove` dy equals the step size, and it is always cancelable |
| claim at 3px or 10px | `pointerup`, container scrolls 0px |
| claim on the first move only (`once`) | `pointerup`, container scrolls 0px |
| claim on every move (`first`) | `pointerup`, container scrolls 0px |
| claim at 30px, 4px steps | `pointercancel`, container scrolls, the claim arrives too late |

The window between the first `touchmove` and the takeover is 15-32px of travel
depending on step size, which is why `TOUCH_CLAIM_PX = 3` has room to spare.
