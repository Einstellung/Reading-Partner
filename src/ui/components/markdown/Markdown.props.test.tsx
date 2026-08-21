// react-markdown v10 hands every custom component the hast `node` alongside the
// element's own attributes. Our anchor override spreads the rest of its props
// onto the <a>, so an unnamed `node` reaches React as an attribute and renders
// as node="[object Object]" in the DOM.

import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownRenderer from './MarkdownRenderer';
import { CitationContext } from './Markdown';

function plain(markdown: string): string {
	return renderToStaticMarkup(createElement(MarkdownRenderer, { text: markdown }));
}

function withCitations(markdown: string): string {
	return renderToStaticMarkup(
		createElement(
			CitationContext.Provider,
			{ value: () => {} },
			createElement(MarkdownRenderer, { text: markdown }),
		),
	);
}

test('a plain external link carries no node attribute', () => {
	const html = plain('[docs](https://example.com)');
	expect(html).toContain('<a href="https://example.com">docs</a>');
	expect(html).not.toContain('node=');
});

test('a citation chip carries no node attribute', () => {
	const html = withCitations('as the survey notes [p.12], retrieval helps');
	expect(html).toContain('href="#rp-page-12"');
	expect(html).not.toContain('node=');
});
