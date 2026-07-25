// Dev-only diagnostic for the streaming "gray vertical line" glitch (chat view,
// classroom on). The markdown re-parse path is ruled out — see
// Markdown.stream.test.tsx: block structure is monotonic while a reply streams,
// so no table/hr/blockquote/pre border appears then vanishes. The remaining
// suspects are layout: an overlay scrollbar on the chat scroll region (or an
// inner overflow container) flashing on each delta as content height changes.
//
// This hook runs on every render of a streaming reply and logs each candidate —
// bordered block, or scrollable descendant/ancestor — with its on-screen
// geometry, so the flickering line can be matched to a concrete element and rect
// on device in seconds. It compiles out of production builds (import.meta.env.DEV).

import { useEffect, type RefObject } from 'react';

function geom(el: Element): string {
	const r = el.getBoundingClientRect();
	return `${Math.round(r.width)}x${Math.round(r.height)} @(${Math.round(r.left)},${Math.round(r.top)})`;
}

function scrolls(el: Element): boolean {
	return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
}

function label(el: Element): string {
	const cls = typeof el.className === 'string' ? el.className : '';
	return cls ? `${el.tagName.toLowerCase()}.${cls.split(/\s+/).slice(0, 3).join('.')}` : el.tagName.toLowerCase();
}

export function useFlickerProbe(ref: RefObject<HTMLElement>, tag: string, active: boolean | undefined): void {
	// No dependency array on purpose: fire after every render so a per-delta
	// flicker shows up in the log cadence.
	useEffect(() => {
		if (!import.meta.env.DEV || !active) return;
		const root = ref.current;
		if (!root) return;
		const rows: string[] = [];
		root.querySelectorAll('table, hr, blockquote, pre').forEach((el) => {
			rows.push(`border <${el.tagName.toLowerCase()}> ${geom(el)}`);
		});
		root.querySelectorAll('*').forEach((el) => {
			if (scrolls(el)) rows.push(`scroll(desc) ${label(el)} ${geom(el)}`);
		});
		for (let el: Element | null = root.parentElement; el; el = el.parentElement) {
			if (scrolls(el)) rows.push(`scroll(anc) ${label(el)} ${geom(el)}`);
		}
		if (rows.length) console.debug(`[flicker ${tag}]`, rows);
	});
}
