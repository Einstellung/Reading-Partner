// What canonicalizeMathFences must move and what it must leave alone. The cases
// are the shapes the model actually writes (docs/pitfall/156); the last tests
// parse them through the real plugin set, which is where the bug shows.

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
	// The shape most of the stored formulas are written in. remark reads them as
	// inline math and they render.
	const three = c('$$A$$\n$$B$$\n$$C$$');
	expect(canonicalizeMathFences(three)).toBe(three);
	const matrix = c('$$S=\\begin{bmatrix}0.99&0.95\\\\0.95&1.49\\end{bmatrix}$$');
	expect(canonicalizeMathFences(matrix)).toBe(matrix);
});

test('a run that does not start its line is left where it is', () => {
	// Anywhere but the start of a line, `$$` is inline math: it spans newlines,
	// it stops at a blank line, and it renders as written. None of it is ours,
	// paired or not.
	for (const text of [
		'用矩阵：$$S=\\begin{bmatrix}\n1&2\n\\end{bmatrix}$$ 然后。',
		'定价 $$29.99。\n\n爱因斯坦 $$E=mc^2$$ 有名。',
		'看这个：$$x=1\n$$',
		'看这个：$$x=\n1$$ 然后呢。',
		'- 见：$$x=\n1$$\n- 下一条',
		'> 见：$$x=\n> 1$$ 继续',
		'成本 $5 到 $$8',
	]) {
		expect(canonicalizeMathFences(c(text))).toBe(text);
	}
});

test('four spaces of indentation are an indented code block, not an opener', () => {
	// Three is the deepest a flow construct can open at, so the fourth space puts
	// the run in code, where remark never reads it as a delimiter.
	for (const text of ['    echo $$', '    $$x=\n    1$$']) {
		expect(canonicalizeMathFences(c(text))).toBe(text);
	}
	expect(canonicalizeMathFences(c('   $$x=\n1$$'))).toBe('   $$\n   x=\n   1\n   $$');
});

test('content on the opening line, the closing line, or both', () => {
	expect(canonicalizeMathFences(c('$$\nx=1$$'))).toBe('$$\nx=1\n$$');
	expect(canonicalizeMathFences(c('$$x=\n1$$'))).toBe('$$\nx=\n1\n$$');
});

test('prose after the closing fence moves to its own line', () => {
	// A closing line has to hold nothing but the run: `$$ 然后。` opens a second
	// block instead of closing the first.
	expect(canonicalizeMathFences(c('$$x=\n1$$ 然后呢。'))).toBe('$$\nx=\n1\n$$\n然后呢。');
});

test('blank lines around the block are kept', () => {
	expect(canonicalizeMathFences(c('前文。\n\n$$x=\n1$$\n\n后文。'))).toBe('前文。\n\n$$\nx=\n1\n$$\n\n后文。');
});

test('a block whose content crosses a blank line still moves', () => {
	// The blank line does not close a flow block, so untransformed this one eats
	// everything after it.
	expect(canonicalizeMathFences(c('$$x=1\n\n还有 y$$ 完。'))).toBe('$$\nx=1\n\n还有 y\n$$\n完。');
});

test('already canonical text is byte-identical', () => {
	const text = c('$$\nx=1\n$$');
	expect(canonicalizeMathFences(text)).toBe(text);
});

test('inserted lines carry their container', () => {
	// Fences prefixed but body lines left lazy splits the item and lets the block
	// escape the quote, so every line gets the prefix. The marker itself becomes
	// spaces rather than growing a second bullet.
	expect(canonicalizeMathFences(c('- $$x=\n  1$$'))).toBe('- $$\n  x=\n  1\n  $$');
	expect(canonicalizeMathFences(c('1. $$x=\n   1$$'))).toBe('1. $$\n   x=\n   1\n   $$');
	expect(canonicalizeMathFences(c('- 一\n  - $$x=\n    1$$\n- 三'))).toBe('- 一\n  - $$\n    x=\n    1\n    $$\n- 三');
	expect(canonicalizeMathFences(c('> $$x=\n> 1$$ 继续'))).toBe('> $$\n> x=\n> 1\n> $$\n> 继续');
	expect(canonicalizeMathFences(c('> > $$x=\n> > 1$$'))).toBe('> > $$\n> > x=\n> > 1\n> > $$');
	expect(canonicalizeMathFences(c('> - $$x=\n>   1$$'))).toBe('> - $$\n>   x=\n>   1\n>   $$');
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
		// A fence opened after a list marker still opens a code block; missing it
		// leaves an unterminated fence that swallows the rest of the message.
		'1. ```python\n   x = "$$a"\n   ```',
	]) {
		expect(canonicalizeMathFences(c(text))).toBe(text);
	}
});

test('a fence after a list marker closes where it says it does', () => {
	expect(
		canonicalizeMathFences(c('- ```py\n  x = 1\n  ```\n\n然后：\n\n$$S=\\begin{bmatrix}\n1&2\n\\end{bmatrix}$$\n\n完。')),
	).toBe('- ```py\n  x = 1\n  ```\n\n然后：\n\n$$\nS=\\begin{bmatrix}\n1&2\n\\end{bmatrix}\n$$\n\n完。');
});

test('a $$ inside a code span is not a delimiter', () => {
	// The run in the span is invisible, so the one on the next line opens the
	// block and the span is left as the model wrote it.
	expect(canonicalizeMathFences(c('`$$` 是分隔符。\n$$x=1\ny=2\n$$ tail'))).toBe(
		'`$$` 是分隔符。\n$$\nx=1\ny=2\n$$\ntail',
	);
});

test('two blocks in one message both move, and nothing is duplicated', () => {
	expect(canonicalizeMathFences(c('$$x=\n1$$\n$$y=\n2$$'))).toBe('$$\nx=\n1\n$$\n$$\ny=\n2\n$$');
});

test('a $$ enclosed by inline math is left where it is', () => {
	const text = c('$x $$ y$');
	expect(canonicalizeMathFences(text)).toBe(text);
});

test('a run of three never closes on a run of two', () => {
	// remark refuses this pairing, so the opener is not a delimiter and is
	// neutralized rather than left to open a block. The run after it never
	// started a line and stays as it is.
	expect(canonicalizeMathFences(c('$$$x=\n1$$'))).toBe('\\$\\$\\$x=\n1$$');
});

test('a run whose closer has not arrived yet is escaped', () => {
	// Mid-stream. Left alone it opens a flow block that swallows the rest of the
	// reply; escaped, the half-written formula shows as the source it is.
	expect(canonicalizeMathFences(c('矩阵：\n$$S=\\begin{bmatrix}\n0.99'))).toBe(
		'矩阵：\n\\$\\$S=\\begin{bmatrix}\n0.99',
	);
	// And the escape is gone as soon as the closing run arrives.
	expect(canonicalizeMathFences(c('矩阵：\n$$S=1\n$$'))).toBe('矩阵：\n$$\nS=1\n$$');
});

test('CRLF text stays CRLF', () => {
	expect(canonicalizeMathFences(c('$$x=\r\n1$$\r\n后文。'))).toBe('$$\r\nx=\r\n1\r\n$$\r\n后文。');
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

// The mdast the renderer actually gets, as one flat line per node that carries
// text. A plugin appended to the real set keeps the tree, so nothing about the
// parse is reconstructed here.
function tree(markdown: string): string[] {
	let root: any = { type: 'root' };
	const capture = () => (node: any) => {
		root = node;
	};
	renderToStaticMarkup(
		createElement(ReactMarkdown, { remarkPlugins: [...remarkPlugins, capture] } as any, markdown),
	);
	const out: string[] = [];
	(function walk(node: any) {
		if (node.type === 'math') out.push(`math(${node.meta ?? ''}):${node.value}`);
		else if (node.type === 'inlineMath' || node.type === 'code' || node.type === 'text')
			out.push(`${node.type}:${node.value}`);
		else if (node.type === 'paragraph') out.push('p');
		for (const child of node.children ?? []) walk(child);
	})(root);
	return out;
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

test('a mid-line run already parses as inline math and keeps doing so', () => {
	const matrix = '用矩阵：$$S=\\begin{bmatrix}\n1&2\n\\end{bmatrix}$$ 然后。';
	const parsed = ['p', 'text:用矩阵：', 'inlineMath:S=\\begin{bmatrix}\n1&2\n\\end{bmatrix}', 'text: 然后。'];
	expect(tree(matrix)).toEqual(parsed);
	expect(tree(canonicalizeMathFences(matrix))).toEqual(parsed);

	// Inline math stops at a blank line, so the price is prose and only the
	// second pair is a formula.
	const price = '定价 $$29.99。\n\n爱因斯坦 $$E=mc^2$$ 有名。';
	const asWritten = ['p', 'text:定价 $$29.99。', 'p', 'text:爱因斯坦 ', 'inlineMath:E=mc^2', 'text: 有名。'];
	expect(tree(price)).toEqual(asWritten);
	expect(tree(canonicalizeMathFences(price))).toEqual(asWritten);
});

test('a line-start run that crosses a blank line stops eating the rest', () => {
	const text = '$$x=1\n\n还有 y$$ 完。';
	expect(tree(text)).toEqual(['math(x=1):\n还有 y$$ 完。']);
	expect(tree(canonicalizeMathFences(text))).toEqual(['math():x=1\n\n还有 y', 'p', 'text:完。']);
});

test('an indented code block keeps its dollars', () => {
	const text = '    echo $$';
	expect(tree(text)).toEqual(['code:echo $$']);
	expect(tree(canonicalizeMathFences(text))).toEqual(['code:echo $$']);
});

test('a fence opened after a list marker leaves the formula after it reachable', () => {
	const text = '- ```py\n  x = 1\n  ```\n\n然后：\n\n$$S=\\begin{bmatrix}\n1&2\n\\end{bmatrix}$$\n\n完。';
	expect(tree(text)).toEqual([
		'code:x = 1',
		'p',
		'text:然后：',
		'math(S=\\begin{bmatrix}):1&2\n\\end{bmatrix}$$\n\n完。',
	]);
	expect(tree(canonicalizeMathFences(text))).toEqual([
		'code:x = 1',
		'p',
		'text:然后：',
		'math():S=\\begin{bmatrix}\n1&2\n\\end{bmatrix}',
		'p',
		'text:完。',
	]);
});

test('a dollar run inside a list-marked fence is code either way', () => {
	const text = '1. ```python\n   x = "$$a"\n   ```';
	expect(tree(text)).toEqual(['code:x = "$$a"']);
	expect(tree(canonicalizeMathFences(text))).toEqual(['code:x = "$$a"']);
});
