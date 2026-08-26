// A [fig:N] card is drawn wherever there is a figure host, with or without a
// citation handler: the card opens in place, so it needs nothing to jump to.
// The retell, the rehearsal note and the coach are the surfaces that have the
// one and not the other (MaterialFigureScope), and the thing to keep true there
// is that turning figures on did not turn every other citation into a chip that
// leads nowhere.

import { expect, test } from 'bun:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownRenderer from './MarkdownRenderer';
import { CitationContext, FigureContext, type FigureHost } from './Markdown';
import type { Figure } from '../../../reading/figures';

const FIG3: Figure = { id: '3', page: 5, caption: 'A schematic of the loop', bbox: null };

const HOST: FigureHost = {
	getFigure: (id) => (id === '3' ? FIG3 : null),
	renderCard: async () => null,
	onJump: () => {},
};

function render(markdown: string, opts: { host?: FigureHost; onCitation?: boolean }): string {
	let tree: ReactNode = createElement(MarkdownRenderer, { text: markdown });
	if (opts.host) tree = createElement(FigureContext.Provider, { value: opts.host }, tree);
	if (opts.onCitation) tree = createElement(CitationContext.Provider, { value: () => {} }, tree);
	return renderToStaticMarkup(tree);
}

test('a figure host with no handler draws the card', () => {
	const html = render('the loop is one pass [fig:3]', { host: HOST });
	expect(html).toContain('Fig. 3');
	expect(html).toContain('A schematic of the loop');
	expect(html).not.toContain('[fig:3]');
});

test('a figure host with no handler leaves page and paper citations as written', () => {
	const html = render('as the survey notes [p.12], and [some-paper p.3] agrees', { host: HOST });
	expect(html).toContain('[p.12]');
	expect(html).toContain('[some-paper p.3]');
	expect(html).not.toContain('#rp-page-');
	expect(html).not.toContain('#rp-paper-');
	expect(html).not.toContain('<a');
});

test('a figure host with no handler still opens a real link in the browser', () => {
	const html = render('[docs](https://example.com)', { host: HOST });
	expect(html).toContain('<a href="https://example.com">docs</a>');
});

test('a figure the host does not have is inert text, not a control', () => {
	const html = render('see [fig:9]', { host: HOST });
	expect(html).toContain('fig:9');
	expect(html).not.toContain('<button');
	expect(html).not.toContain('<a');
});

test('with a handler nothing changes: chips for pages, cards for figures', () => {
	const html = render('the survey [p.12] and [fig:3]', { host: HOST, onCitation: true });
	expect(html).toContain('href="#rp-page-12"');
	expect(html).toContain('Fig. 3');
});

test('a handler and no host: the figure falls back to the chip that jumps', () => {
	const html = render('and [fig:3]', { onCitation: true });
	expect(html).toContain('href="#rp-fig-3"');
});

test('neither host nor handler: every citation is the text the model wrote', () => {
	const html = render('the survey [p.12] and [fig:3]', {});
	expect(html).toContain('[p.12]');
	expect(html).toContain('[fig:3]');
	expect(html).not.toContain('<a');
});
