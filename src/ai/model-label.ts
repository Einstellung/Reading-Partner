// How a model reads in the picker. Its context window is part of the label: the
// app offers every model the provider lists, including the small ones, so the
// number that decides how much of a book fits has to be on screen at the moment
// the model is chosen rather than discovered later in a reply that left half the
// book out.

// A context window as the short number people quote: 128000 -> "128k",
// 1000000 -> "1M", 1500000 -> "1.5M". Null when the metadata declares no usable
// window (pi allows contextWindow <= 0 and exempts those calls from its clamp),
// because there is then nothing to state.
export function formatContextWindow(tokens: number): string | null {
	if (!Number.isFinite(tokens) || tokens <= 0) return null;
	const k = Math.round(tokens / 1_000);
	if (k < 1) return String(Math.round(tokens));
	if (k < 1_000) return `${k}k`;
	return `${Math.round(tokens / 100_000) / 10}M`;
}

// Middle dot rather than a bracket: the window is a second fact about the model,
// not an aside about its name.
const SEPARATOR = " · ";

export function modelChoiceLabel(model: { label: string; contextWindow: number }): string {
	const window = formatContextWindow(model.contextWindow);
	return window ? `${model.label}${SEPARATOR}${window}` : model.label;
}
