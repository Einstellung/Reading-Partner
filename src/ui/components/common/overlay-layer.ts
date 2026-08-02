// How many portalled overlay layers are open right now.
//
// Radix renders an overlay into <body>, outside the tree of whatever opened it.
// The app's own dismiss-on-outside-press overlays (CallBubble, AnnotationPopup)
// decide with `ref.contains(event.target)`, and a portalled subtree is by
// definition not inside that ref: the press that lands on a dialog button reads
// as a press outside the bubble, so the bubble closes and takes the dialog with
// it before the button can fire.
//
// Containment cannot answer the question, so a count answers it instead: while
// any layer is up, no press belongs to the surface underneath it. That also
// covers the parts of a layer that are not the content — the backdrop, the
// popper wrapper — without any of them having to be found in the DOM.
//
// Symmetric by construction: push hands back its own release, which the mounting
// component calls from an effect cleanup, and a double release is a no-op.

let openLayers = 0;

export function pushOverlayLayer(): () => void {
	openLayers++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		openLayers = Math.max(0, openLayers - 1);
	};
}

export function overlayLayerOpen(): boolean {
	return openLayers > 0;
}

// Tests only: the count is module state and outlives a single case.
export function resetOverlayLayers(): void {
	openLayers = 0;
}
