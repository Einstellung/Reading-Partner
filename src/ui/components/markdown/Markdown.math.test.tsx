// A display formula written the way the model writes it has to reach KaTeX as a
// formula. Before the fences were canonicalized (mathFences.ts) this rendered as
// KaTeX's error color over the raw LaTeX plus the rest of the reply.

import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownRenderer from './MarkdownRenderer';
import { CitationContext } from './Markdown';

// KaTeX's errorColor, what a formula it could not parse is painted in. The
// wrapper div's Tailwind classes mention katex-display too, so the marker for a
// rendered block is the attribute KaTeX itself writes.
const ERROR_COLOR = '#cc0000';
const DISPLAY = 'class="katex-display"';

const REPLY =
	'用书里 p.78 那个真实矩阵：\n\n$$S=\\begin{bmatrix}\n0.9995&0.9544\\\\\n0.9544&1.4950\n\\end{bmatrix}$$\n\n现在把 x₃ 和 x₄ 对调。';

function plain(markdown: string): string {
	return renderToStaticMarkup(createElement(MarkdownRenderer, { text: markdown }));
}

function withCitations(markdown: string): string {
	return renderToStaticMarkup(
		createElement(CitationContext.Provider, { value: () => {} }, createElement(MarkdownRenderer, { text: markdown })),
	);
}

test('a multi-line display formula renders as math, not as red LaTeX', () => {
	const html = plain(REPLY);
	expect(html).toContain(DISPLAY);
	expect(html).not.toContain(ERROR_COLOR);
	expect(html).toContain('<p>现在把 x₃ 和 x₄ 对调。</p>');
});

test('the formula and the citations in the same reply both survive', () => {
	const html = withCitations(REPLY.replace('p.78', '[p.78]'));
	expect(html).toContain(DISPLAY);
	expect(html).not.toContain(ERROR_COLOR);
	expect(html).toContain('href="#rp-page-78"');
});

test('a formula still streaming shows as source, not as a red block', () => {
	// Every cut from the opening run to just before the closing one: the block
	// has no closer yet, so nothing is math and nothing is red. It becomes a
	// display block in one step when the closer arrives.
	const open = REPLY.indexOf('$$');
	const closer = REPLY.lastIndexOf('$$');
	for (let cut = open + 1; cut <= closer + 1; cut += 1) {
		const html = plain(REPLY.slice(0, cut));
		expect(html).not.toContain(ERROR_COLOR);
		expect(html).not.toContain(DISPLAY);
	}
	expect(plain(REPLY).split(DISPLAY).length - 1).toBe(1);
});
