// The CJK emphasis cases the remarkPlugins set has to get right, and the ones
// it has to leave alone (docs/pitfall/153). Run: bun test.

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
	expect(html('数学 $x^2$ 行内')).toContain('<code class="language-math math-inline">x^2</code>');
});

test('literal asterisks in prose stay literal', () => {
	const out = html('5 * 3 * 2 = 30');
	expect(out).not.toContain('<strong>');
	expect(out).not.toContain('<em>');
	expect(out).toContain('5 * 3 * 2 = 30');
});
