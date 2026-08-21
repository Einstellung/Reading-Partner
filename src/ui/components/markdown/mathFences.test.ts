// What canonicalizeMathFences must move and what it must leave alone. The cases
// are the shapes the model actually writes (docs/pitfall/156); the last test
// parses one of them through the real plugin set, which is where the bug shows.

import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { canonicalizeMathFences } from './mathFences';
import { remarkPlugins } from './remarkPlugins';

// The failing reply, trimmed: a display matrix written with both fences hugging
// the formula, prose on both sides.
const REAL =
	'用书里 p.78 那个真实矩阵：\n\n$$S=\\begin{bmatrix}\n0.9995&0.9544\\\\\n0.9544&1.4950\n\\end{bmatrix}$$\n\n现在把 x₃ 和 x₄ 对调。';

const REAL_CANONICAL =
	'用书里 p.78 那个真实矩阵：\n\n$$\nS=\\begin{bmatrix}\n0.9995&0.9544\\\\\n0.9544&1.4950\n\\end{bmatrix}\n$$\n\n现在把 x₃ 和 x₄ 对调。';

// Every input this file asserts on, for the idempotence sweep at the end.
const CASES: string[] = [];
function c(text: string): string {
	CASES.push(text);
	return text;
}

test('the real reply gets its fences onto their own lines', () => {
	expect(canonicalizeMathFences(c(REAL))).toBe(REAL_CANONICAL);
});

test('text with nothing to move comes back identical', () => {
	for (const text of ['普通一段话，没有公式。', '成本是 $5，不是 $50。', '数学 $x^2$ 行内', c('$$Q = XW_q$$')]) {
		expect(canonicalizeMathFences(c(text))).toBe(text);
	}
});

test('single-line pairs are left alone, however many', () => {
	// The shape 162 of the stored formulas are written in. remark reads them as
	// inline math and they render; promoting them to display blocks would be a
	// change of style, not of correctness.
	const three = c('$$A$$\n$$B$$\n$$C$$');
	expect(canonicalizeMathFences(three)).toBe(three);
	const matrix = c('$$S=\\begin{bmatrix}0.99&0.95\\\\0.95&1.49\\end{bmatrix}$$');
	expect(canonicalizeMathFences(matrix)).toBe(matrix);
});

test('content on the opening line, the closing line, or both', () => {
	expect(canonicalizeMathFences(c('看这个：$$x=1\n$$'))).toBe('看这个：\n$$\nx=1\n$$');
	expect(canonicalizeMathFences(c('$$\nx=1$$'))).toBe('$$\nx=1\n$$');
	expect(canonicalizeMathFences(c('看这个：$$x=\n1$$'))).toBe('看这个：\n$$\nx=\n1\n$$');
});

test('prose after the closing fence moves to its own line', () => {
	// A closing line has to hold nothing but the run: `$$ 然后。` opens a second
	// block instead of closing the first.
	expect(canonicalizeMathFences(c('看这个：$$x=\n1$$ 然后呢。'))).toBe('看这个：\n$$\nx=\n1\n$$\n然后呢。');
});

test('blank lines around the block are kept', () => {
	expect(canonicalizeMathFences(c('前文。\n\n$$x=\n1$$\n\n后文。'))).toBe('前文。\n\n$$\nx=\n1\n$$\n\n后文。');
});

test('already canonical text is byte-identical', () => {
	const text = c('$$\nx=1\n$$');
	expect(canonicalizeMathFences(text)).toBe(text);
});

test('inserted lines carry their container', () => {
	// Fences prefixed but body lines left lazy splits the item and lets the block
	// escape the quote, so every line gets the prefix.
	expect(canonicalizeMathFences(c('- 见：$$x=\n1$$\n- 下一条'))).toBe('- 见：\n  $$\n  x=\n  1\n  $$\n- 下一条');
	expect(canonicalizeMathFences(c('- 一\n  - 二：$$x=\n  1$$\n- 三'))).toBe(
		'- 一\n  - 二：\n    $$\n    x=\n    1\n    $$\n- 三',
	);
	expect(canonicalizeMathFences(c('1. 见：$$x=\n1$$'))).toBe('1. 见：\n   $$\n   x=\n   1\n   $$');
	expect(canonicalizeMathFences(c('   1. 见：$$x=\n1$$'))).toBe('   1. 见：\n      $$\n      x=\n      1\n      $$');
	// A run right after the marker keeps the marker on its line rather than
	// growing a second bullet.
	expect(canonicalizeMathFences(c('- $$x=\n  1$$'))).toBe('- $$\n  x=\n  1\n  $$');
	expect(canonicalizeMathFences(c('> 见：$$x=\n> 1$$ 继续'))).toBe('> 见：\n> $$\n> x=\n> 1\n> $$\n> 继续');
	expect(canonicalizeMathFences(c('> > 见：$$x=\n> > 1$$'))).toBe('> > 见：\n> > $$\n> > x=\n> > 1\n> > $$');
	expect(canonicalizeMathFences(c('> - 见：$$x=\n> 1$$'))).toBe('> - 见：\n>   $$\n>   x=\n>   1\n>   $$');
});

test('code and escapes are byte-identical', () => {
	for (const text of [
		'```\n$$x=\n1$$\n```',
		'~~~\n$$x=\n1$$\n~~~',
		'   ```js\n$$x=\n1$$\n   ```',
		'`$$x=\n1$$`',
		'a \\$\\$x\n y\\$\\$ b',
		// One end of the pair is inside a fenced block, so neither end moves.
		'$$a\n```\n$$\n```\nb$$',
	]) {
		expect(canonicalizeMathFences(c(text))).toBe(text);
	}
});

test('a $$ inside a code span is not a delimiter', () => {
	// The run in the span is invisible, so the one after it opens the block.
	expect(canonicalizeMathFences(c('see `$$` then $$x=1\ny=2\n$$ tail'))).toBe('see `$$` then\n$$\nx=1\ny=2\n$$\ntail');
});

test('two blocks on one line both move, and nothing is duplicated', () => {
	expect(canonicalizeMathFences(c('a $$x=\n1$$ b $$y=\n2$$ c'))).toBe('a\n$$\nx=\n1\n$$\nb\n$$\ny=\n2\n$$\nc');
});

test('a $$ enclosed by inline math is left where it is', () => {
	const text = c('$x $$ y$');
	expect(canonicalizeMathFences(text)).toBe(text);
});

test('a run of three never closes on a run of two', () => {
	// remark refuses this pairing, so neither run is a delimiter and both are
	// neutralized rather than opening a block.
	expect(canonicalizeMathFences(c('$$$x=\n1$$'))).toBe('\\$\\$\\$x=\n1\\$\\$');
});

test('a run whose closer has not arrived yet is escaped', () => {
	// Mid-stream. Left alone it opens a flow block that swallows the rest of the
	// reply; escaped, the half-written formula shows as the source it is.
	expect(canonicalizeMathFences(c('矩阵：\n$$S=\\begin{bmatrix}\n0.99'))).toBe(
		'矩阵：\n\\$\\$S=\\begin{bmatrix}\n0.99',
	);
	// A lone `$` is a dollar sign in prose, not a half-written delimiter.
	expect(canonicalizeMathFences(c('成本 $5 到 $$8'))).toBe('成本 $5 到 \\$\\$8');
	// And the escape is gone as soon as the closing run arrives.
	expect(canonicalizeMathFences(c('矩阵：\n$$S=1\n$$'))).toBe('矩阵：\n$$\nS=1\n$$');
});

test('CRLF text stays CRLF', () => {
	expect(canonicalizeMathFences(c('看：$$x=\r\n1$$\r\n后文。'))).toBe('看：\r\n$$\r\nx=\r\n1\r\n$$\r\n后文。');
});

// Whitespace-stripped, for the "nothing was deleted" invariant. The transform
// adds newlines, indentation and quote markers; it never drops a character that
// carries meaning.
function dense(text: string): string {
	return text.replace(/\s+/g, '');
}

function isSubsequence(inner: string, outer: string): boolean {
	let i = 0;
	for (let j = 0; j < outer.length && i < inner.length; j += 1) if (inner[i] === outer[j]) i += 1;
	return i === inner.length;
}

test('the transform is a fixed point and deletes nothing', () => {
	// Running it twice has to change nothing: canonical output has the opener
	// alone on its line and its body already prefixed, which is what the second
	// pass would produce.
	for (const text of CASES) {
		const once = canonicalizeMathFences(text);
		expect(canonicalizeMathFences(once)).toBe(once);
		expect(isSubsequence(dense(text), dense(once))).toBe(true);
	}
});

test('a fixed point over random markdown too', () => {
	// A seeded walk over the tokens that decide the scan — fences, escapes,
	// containers, dollar runs — because the cases above are the shapes we thought
	// of and the model writes the ones we did not.
	const tokens = [
		'$$',
		'$',
		'\n',
		'\n\n',
		'a',
		'中',
		' ',
		'  ',
		'- ',
		'> ',
		'1. ',
		'`',
		'```',
		'\\$',
		'\\\\',
		'[p.5]',
		'\t',
		'~~~',
		'x=1',
	];
	let seed = 12345;
	const next = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
	for (let n = 0; n < 2000; n += 1) {
		let text = '';
		const parts = 1 + Math.floor(next() * 14);
		for (let k = 0; k < parts; k += 1) text += tokens[Math.floor(next() * tokens.length)];
		const once = canonicalizeMathFences(text);
		expect(canonicalizeMathFences(once)).toBe(once);
		expect(isSubsequence(dense(text), dense(once))).toBe(true);
	}
});

// The parse the renderer actually gets, plugins and all, KaTeX left out of it.
function html(markdown: string): string {
	return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins } as any, markdown));
}

test('the canonical form parses as one display block, the raw form does not', () => {
	const fixed = html(canonicalizeMathFences(REAL));
	expect(fixed).toContain(
		'<code class="language-math math-display">S=\\begin{bmatrix}\n0.9995&amp;0.9544\\\\\n0.9544&amp;1.4950\n\\end{bmatrix}</code>',
	);
	expect(fixed).toContain('<p>现在把 x₃ 和 x₄ 对调。</p>');
	// Untransformed, the block loses its opening line to `meta` and eats the rest
	// of the reply, prose and all.
	const raw = html(REAL);
	expect(raw).not.toContain('<p>现在把 x₃ 和 x₄ 对调。</p>');
	expect(raw).toContain('现在把 x₃ 和 x₄ 对调。</code>');
});
