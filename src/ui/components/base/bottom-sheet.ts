// Whether a sheet is standing on the bottom edge of the screen right now.
//
// The phone's sheets are portalled to <body> and pinned across that edge
// (ui/dialog.tsx DialogSheetContent). So is Lumen's corner, nine hundred layers
// lower (ui/overlay.tsx OVERLAY_Z), which is how the companion ends up painted
// over the last row of a list. Nothing in the tree relates the two — a sheet is
// opened deep inside a screen and the corner is drawn by the shell — so the
// sheet says it is there and the corner reads it.
//
// Watched, unlike the layer count next door (overlay-layer.ts): that one is
// asked at the moment of a press, and this one has to reach a render.
//
// Out of sight and not lifted. A sheet is as tall as its list, so a corner
// raised clear of one would stand in the middle of it.

let openSheets = 0;
const watchers = new Set<() => void>();

/** Registered by the sheet's own content, released when it unmounts. */
export function pushBottomSheet(): () => void {
  openSheets++;
  announce();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openSheets = Math.max(0, openSheets - 1);
    announce();
  };
}

export function bottomSheetOpen(): boolean {
  return openSheets > 0;
}

export function subscribeBottomSheet(watch: () => void): () => void {
  watchers.add(watch);
  return () => {
    watchers.delete(watch);
  };
}

function announce(): void {
  for (const watch of [...watchers]) watch();
}

// Tests only: the count is module state and outlives a single case.
export function resetBottomSheets(): void {
  openSheets = 0;
  announce();
}
