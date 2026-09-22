// Streaming re-parse guard for AI chat replies.
//
// Hypothesis under test: while a reply streams, MarkdownRenderer re-parses the
// whole partial text on every delta, and a half-written trailing construct
// (table delimiter row, `---` rule, `>` quote, code fence) transiently parses
// into a bordered block element (table column rules, blockquote border-l, hr,
// pre box) that then vanishes — reading on screen as a gray line that flickers
// through the reply.
//
// Verdict: acquitted. Rendering a realistic classroom answer character by
// character, no border-bearing element ever appears at one prefix and is gone
// at the next. Block structure is monotonic for well-formed replies. This test
// pins that: if a future change makes the markdown path flicker, it fails here.

import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { linkifyCitations } from '../../../reading/prep/anchors';
import { remarkPlugins } from './remarkPlugins';
import MarkdownRenderer from './MarkdownRenderer';
import { CitationModeContext } from './Markdown';

// The block elements our chat CSS gives borders to (see Markdown.tsx MD):
//   table/th/td -> vertical column rules, hr -> horizontal rule,
//   blockquote  -> border-l, pre -> bordered box.
const BORDER_TAGS = ['table', 'hr', 'blockquote', 'pre'] as const;
type BorderTag = (typeof BORDER_TAGS)[number];

function borderCounts(markdown: string): Record<BorderTag, number> {
	const html = renderToStaticMarkup(
		createElement(ReactMarkdown, { remarkPlugins } as any, markdown),
	);
	const out = {} as Record<BorderTag, number>;
	for (const tag of BORDER_TAGS) out[tag] = html.split(`<${tag}`).length - 1;
	return out;
}

// A realistic classroom reply exercising every border-bearing construct plus
// the ambiguous cases (setext-vs-hr rules, pipes and arrows in prose, a fenced
// code block) that are the likeliest to toggle mid-stream.
const REPLY = [
	'Good question. The two grounding strategies compare like this:',
	'',
	'| Method | Idea | Cost |',
	'| --- | --- | --- |',
	'| Retrieval | Fetch top-k passages | Low |',
	'| Fine-tune | Adapt the weights | High |',
	'',
	'The pipeline is: query -> retrieve -> rerank -> generate.',
	'When recall | precision must be balanced, favor recall.',
	'',
	'As the survey notes [p.12], retrieval augmentation reduces hallucination.',
	'',
	'A minimal call:',
	'',
	'```python',
	'answer = rag(query, corpus)',
	'```',
	'',
	'> Retrieval grounds the model in sources it can cite.',
	'',
	'Summary',
	'---',
	'',
	'In short, prefer retrieval when the corpus changes often.',
].join('\n');

// A flicker is a border element present at one prefix and gone at the next
// character (appears, then disappears as more text streams).
function flickers(transform: (s: string) => string) {
	let prev = borderCounts(transform(''));
	const hits: { at: number; tag: BorderTag; from: number; to: number; tail: string }[] = [];
	for (let i = 1; i <= REPLY.length; i++) {
		const counts = borderCounts(transform(REPLY.slice(0, i)));
		for (const tag of BORDER_TAGS) {
			if (counts[tag] < prev[tag]) {
				hits.push({ at: i, tag, from: prev[tag], to: counts[tag], tail: JSON.stringify(REPLY.slice(Math.max(0, i - 20), i)) });
			}
		}
		prev = counts;
	}
	return hits;
}

test('raw streaming produces no transient bordered element', () => {
	const hits = flickers((s) => s);
	if (hits.length) console.log('RAW flickers:', hits);
	expect(hits).toEqual([]);
});

test('classroom (citation-linkified) streaming produces no transient bordered element', () => {
	const hits = flickers(linkifyCitations);
	if (hits.length) console.log('LINKIFIED flickers:', hits);
	expect(hits).toEqual([]);
});

// The lesson's quotation block (CitationMode "quote") streams under the same
// rule. It is not a border-bearing tag the scan above can see, and it is drawn
// by our own paragraph override rather than by the markdown parse, so it is
// counted here by its own marker through the real renderer.
//
// The state to fear is the half-written bracket: `[p.3 "The inp` is a quote
// whose closing mark has not arrived. It must not draw a block that the next
// character takes away again — and it does not, because a bracket the scanner
// has not seen closed is not a candidate at all.
function quoteBlocks(markdown: string): number {
	const html = renderToStaticMarkup(
		createElement(
			CitationModeContext.Provider,
			{ value: 'quote' as const },
			createElement(MarkdownRenderer, { text: markdown }),
		),
	);
	return html.split('data-page-quote').length - 1;
}

const LESSON = [
	'Section 3.1 is where the embeddings are defined.',
	'',
	'[p.3 "The input embeddings are the sum of the token and the position embeddings."]',
	'',
	'So position is added, not concatenated. Why would that be cheaper?',
].join('\n');

test('a quotation block never appears and then vanishes mid-stream', () => {
	let prev = 0;
	const hits: { at: number; from: number; tail: string }[] = [];
	for (let i = 1; i <= LESSON.length; i++) {
		const n = quoteBlocks(LESSON.slice(0, i));
		if (n < prev) hits.push({ at: i, from: prev, tail: JSON.stringify(LESSON.slice(Math.max(0, i - 20), i)) });
		prev = n;
	}
	if (hits.length) console.log('QUOTE flickers:', hits);
	expect(hits).toEqual([]);
	// And the finished reply does draw one, so the scan above was not counting
	// nothing all the way through.
	expect(quoteBlocks(LESSON)).toBe(1);
});
