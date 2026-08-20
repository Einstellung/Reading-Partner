// Emphasis around CJK, which CommonMark alone gets wrong.
//
// A `**` run closes only when it is right-flanking, and a run preceded by
// punctuation has to be followed by whitespace or punctuation as well. Chinese
// puts a full stop, a colon or a closing quote right before the delimiter and
// an ideograph right after it, so the run never closes and the asterisks stay
// on screen (docs/pitfall/153). The cjk-friendly plugins in remarkPlugins.ts
// widen that rule; this pins the cases they fix and the ones they must leave
// alone.

import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { remarkPlugins } from './remarkPlugins';

function html(markdown: string): string {
	return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins } as any, markdown));
}

test('bold closes between CJK punctuation and an ideograph', () => {
	expect(html('**为什么这会毁掉“点积=相似度”。**点积衡量的是')).toContain(
		'<strong>为什么这会毁掉“点积=相似度”。</strong>点积衡量的是',
	);
	expect(html('**结论：**这样不行')).toContain('<strong>结论：</strong>这样不行');
});

test('strikethrough closes between CJK punctuation and an ideograph', () => {
	expect(html('~~删除线。~~接着')).toContain('<del>删除线。</del>接着');
});

test('the cases that already worked still work', () => {
	expect(html('这是**重点**。')).toContain('这是<strong>重点</strong>。');
	expect(html('**bold**text')).toContain('<strong>bold</strong>text');
});

test('inline math is untouched', () => {
	// remark-math leaves the node for rehype-katex; without it the source stays
	// verbatim. Either way the `$` pair must not become emphasis.
	expect(html('数学 $x^2$ 行内')).not.toContain('<strong>');
});

test('literal asterisks in prose stay literal', () => {
	const out = html('5 * 3 * 2 = 30');
	expect(out).not.toContain('<strong>');
	expect(out).not.toContain('<em>');
	expect(out).toContain('5 * 3 * 2 = 30');
});
