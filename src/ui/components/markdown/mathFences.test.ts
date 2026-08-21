// What canonicalizeMathFences must cut and what it must leave alone. The cases
// are the shapes the model actually writes (docs/pitfall/156), and the ones that
// matter are asserted against the tree the real plugin set builds, before and
// after, because that parse is the whole reason this module exists.

import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { canonicalizeMathFences } from './mathFences';
import { remarkPlugins } from './remarkPlugins';

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
		else if (node.type === 'inlineMath' || node.type === 'code' || node.type === 'text' || node.type === 'html')
			out.push(`${node.type}:${node.value}`);
		else if (node.type === 'paragraph') out.push('p');
		for (const child of node.children ?? []) walk(child);
	})(root);
	return out;
}

// The parse the renderer actually gets, plugins and all, KaTeX left out of it.
function html(markdown: string): string {
	return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins } as any, markdown));
}

// Every input this file asserts on, for the idempotence sweep at the end.
const CASES: string[] = [];
function c(text: string): string {
	CASES.push(text);
	return text;
}

// The two replies in the stored threads that this module exists for: the only
// two of 516 messages it changes a byte of.
const REAL =
	'用书里 p.78 那个真实矩阵：\n\n$$S=\\begin{bmatrix}\n0.9995&0.9544\\\\\n0.9544&1.4950\n\\end{bmatrix}$$\n\n现在把 x₃ 和 x₄ 对调。';

const REAL_CANONICAL =
	'用书里 p.78 那个真实矩阵：\n\n$$\nS=\\begin{bmatrix}\n0.9995&0.9544\\\\\n0.9544&1.4950\n\\end{bmatrix}\n$$\n\n现在把 x₃ 和 x₄ 对调。';

const ALIGNED =
	'笨办法第 3 步在做的是：先取全长 softmax 的 $\\alpha_{ij}$，再除以该行未屏蔽部分的和。\n\n' +
	'$$\\frac{\\alpha_{ij}}{\\sum_{k\\le i}\\alpha_{ik}}\n' +
	'=\\frac{\\dfrac{e^{s_{ij}}}{\\sum_{k=1}^{T}e^{s_{ik}}}}{\\displaystyle\\sum_{k\\le i}\\dfrac{e^{s_{ik}}}{\\sum_{k=1}^{T}e^{s_{ik}}}}\n' +
	'=\\frac{e^{s_{ij}}}{\\sum_{k\\le i}e^{s_{ik}}}$$\n\n分子分母各有一个公因子，约掉了。';

// The one shape that is broken, and the three neighbouring ones that are not.
// Each is measured against the real parse first: the module is allowed to touch
// the first and nothing else.

test('a $$ alone on its line already opens and closes a block', () => {
	const text = c('$$\nx=1\n$$');
	expect(tree(text)).toEqual(['math():x=1']);
	expect(canonicalizeMathFences(text)).toBe(text);
});

test('a run that does not start its line is inline math and spans newlines', () => {
	const text = c('用矩阵：$$S=a\nb$$ 然后。');
	expect(tree(text)).toEqual(['p', 'text:用矩阵：', 'inlineMath:S=a\nb', 'text: 然后。']);
	expect(canonicalizeMathFences(text)).toBe(text);

	// It does stop at a blank line, which is what makes the price prose.
	const price = c('定价 $$29.99。\n\n爱因斯坦 $$E=mc^2$$ 有名。');
	expect(tree(price)).toEqual(['p', 'text:定价 $$29.99。', 'p', 'text:爱因斯坦 ', 'inlineMath:E=mc^2', 'text: 有名。']);
	expect(canonicalizeMathFences(price)).toBe(price);
});

test('a line-start pair whose remainder holds any dollar falls back to inline math', () => {
	// micromark rejects the meta on the first dollar it meets, whatever run that
	// dollar belongs to, and inline math renders. This is how most of the stored
	// formulas are written.
	const text = c('$$S=\\begin{bmatrix}0.9&0.5\\end{bmatrix}$$');
	expect(tree(text)).toEqual(['p', 'inlineMath:S=\\begin{bmatrix}0.9&0.5\\end{bmatrix}']);
	expect(canonicalizeMathFences(text)).toBe(text);
	// A single `$` is enough, so a sentence naming both delimiters is prose and
	// not a broken opener.
	const naming = c('$$ 表示块公式，$ 表示行内公式。\nx=1\n$$');
	expect(tree(naming)).toEqual(['p', 'text:$$ 表示块公式，$ 表示行内公式。\nx=1', 'math():']);
	expect(canonicalizeMathFences(naming)).toBe(naming);
	for (const other of [
		c('$$Q = XW_q$$'),
		c('$$A$$\n$$B$$\n$$C$$'),
		c('$$x=1$$ 然后。'),
		c('$$ 表示块公式，$ 表示行内公式。'),
	]) {
		expect(canonicalizeMathFences(other)).toBe(other);
	}
});

test('a line-start run with more on its line is the broken shape', () => {
	// `S=a` becomes the node's meta and is dropped, `b$$` does not close the
	// block, and the prose after it is swallowed into the same red run of LaTeX.
	const text = c('$$S=a\nb$$\n\n正文。');
	expect(tree(text)).toEqual(['math(S=a):b$$\n\n正文。']);
	const fixed = canonicalizeMathFences(text);
	expect(fixed).toBe('$$\nS=a\nb\n$$\n\n正文。');
	expect(tree(fixed)).toEqual(['math():S=a\nb', 'p', 'text:正文。']);
});

test('the real reply gets its fences onto their own lines', () => {
	expect(canonicalizeMathFences(c(REAL))).toBe(REAL_CANONICAL);
	const fixed = html(REAL_CANONICAL);
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

test('the second stored reply, three lines of one aligned fraction', () => {
	expect(canonicalizeMathFences(c(ALIGNED))).toBe(
		// A `$$` in a replacement string is an escaped dollar, hence the functions.
		ALIGNED.replace('$$\\frac', () => '$$\n\\frac').replace('e^{s_{ik}}}$$', () => 'e^{s_{ik}}}\n$$'),
	);
	expect(tree(ALIGNED).filter((n) => n.startsWith('math('))).toEqual([
		'math(\\frac{\\alpha_{ij}}{\\sum_{k\\le i}\\alpha_{ik}}):' +
			'=\\frac{\\dfrac{e^{s_{ij}}}{\\sum_{k=1}^{T}e^{s_{ik}}}}{\\displaystyle\\sum_{k\\le i}\\dfrac{e^{s_{ik}}}{\\sum_{k=1}^{T}e^{s_{ik}}}}\n' +
			'=\\frac{e^{s_{ij}}}{\\sum_{k\\le i}e^{s_{ik}}}$$\n\n分子分母各有一个公因子，约掉了。',
	]);
	expect(tree(canonicalizeMathFences(ALIGNED)).slice(-2)).toEqual(['p', 'text:分子分母各有一个公因子，约掉了。']);
});

// The four inputs review 3 broke on. Each is asserted as a tree so a future
// pairing scheme cannot pass by producing plausible-looking text.

test('a price earlier in the reply does not eat the opener', () => {
	const text = c('价格 $$100 元。\n\n$$S=\\begin{bmatrix}\n0.9&0.5\n\\end{bmatrix}$$\n\n正文结尾。');
	expect(tree(text)).toEqual([
		'p',
		'text:价格 $$100 元。',
		'math(S=\\begin{bmatrix}):0.9&0.5\n\\end{bmatrix}$$\n\n正文结尾。',
	]);
	expect(tree(canonicalizeMathFences(text))).toEqual([
		'p',
		'text:价格 $$100 元。',
		'math():S=\\begin{bmatrix}\n0.9&0.5\n\\end{bmatrix}',
		'p',
		'text:正文结尾。',
	]);
});

test('a quoted formula does not drag the prose after it into itself', () => {
	// The block ends where the blockquote ends. Both paragraphs stay paragraphs
	// and the price stays prose.
	const text = c('> $$\n> a=1\n\n普通正文一段。\n\n价格 $$100 元。');
	const parsed = ['math():a=1', 'p', 'text:普通正文一段。', 'p', 'text:价格 $$100 元。'];
	expect(tree(text)).toEqual(parsed);
	expect(canonicalizeMathFences(text)).toBe(text);
	expect(tree(canonicalizeMathFences(text))).toEqual(parsed);
});

test('a quoted formula that is still open is left alone, not escaped', () => {
	// It is already canonical: remark reads it as a formula as it stands, and
	// escaping it would turn a working block into literal text.
	const text = c('> $$\n> a=1');
	expect(tree(text)).toEqual(['math():a=1']);
	expect(canonicalizeMathFences(text)).toBe(text);
});

test('a paragraph that opens with $$ keeps the text after the formula', () => {
	// Nothing rescues this line: remark reads any line-start `$$` as a fence, so
	// the sentence about the delimiter is inside a formula whichever way it is
	// cut. What the cut buys is the closer — the formula's own `$$` now ends the
	// block, so the paragraph after it is a paragraph again.
	const text = c('$$ 是块公式的定界符。\n\n$$a=1\nb=2$$\n\n正文。');
	expect(tree(text)).toEqual(['math(是块公式的定界符。):\n$$a=1\nb=2$$\n\n正文。']);
	expect(tree(canonicalizeMathFences(text))).toEqual([
		'math():是块公式的定界符。\n\n$$a=1\nb=2',
		'p',
		'text:正文。',
	]);
});

// Everything below is a shape the cut has to get right, or a shape it has to
// keep its hands off.

test('text with nothing to cut comes back identical', () => {
	for (const text of [
		'普通一段话，没有公式。',
		'成本是 $5，不是 $50。',
		'数学 $x^2$ 行内',
		'成本 $5 到 $$8',
		'$x $$ y$',
	]) {
		expect(canonicalizeMathFences(c(text))).toBe(text);
	}
});

test('a run that starts no line is left where it is, paired or not', () => {
	for (const text of [
		'看这个：$$x=1\n$$',
		'看这个：$$x=\n1$$ 然后呢。',
		'- 见：$$x=\n1$$\n- 下一条',
		'> 见：$$x=\n> 1$$ 继续',
	]) {
		expect(canonicalizeMathFences(c(text))).toBe(text);
	}
});

test('four spaces of indentation are an indented code block, not an opener', () => {
	// Three is the deepest a flow construct can open at, so the fourth space puts
	// the run in code, where remark never reads it as a delimiter.
	const indented = c('    echo $$');
	expect(tree(indented)).toEqual(['code:echo $$']);
	expect(canonicalizeMathFences(indented)).toBe(indented);
	expect(canonicalizeMathFences(c('    $$x=\n    1$$'))).toBe('    $$x=\n    1$$');
	// Three spaces do open one, and only the two fence lines are rewritten.
	expect(canonicalizeMathFences(c('   $$x=\n1$$'))).toBe('   $$\n   x=\n1\n   $$');
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

test('blank lines around and inside the block are kept', () => {
	expect(canonicalizeMathFences(c('前文。\n\n$$x=\n1$$\n\n后文。'))).toBe('前文。\n\n$$\nx=\n1\n$$\n\n后文。');
	// A blank line does not close a flow block at the top level, so untransformed
	// this one eats everything after it.
	const crossing = c('$$x=1\n\n还有 y$$ 完。');
	expect(tree(crossing)).toEqual(['math(x=1):\n还有 y$$ 完。']);
	expect(canonicalizeMathFences(crossing)).toBe('$$\nx=1\n\n还有 y\n$$\n完。');
	expect(tree(canonicalizeMathFences(crossing))).toEqual(['math():x=1\n\n还有 y', 'p', 'text:完。']);
});

test('two blocks in one message both move, and nothing is duplicated', () => {
	expect(canonicalizeMathFences(c('$$x=\n1$$\n$$y=\n2$$'))).toBe('$$\nx=\n1\n$$\n$$\ny=\n2\n$$');
});

test('inserted lines carry their container', () => {
	// Fences prefixed but body lines left lazy splits the item and lets the block
	// escape the quote, so every inserted line gets the prefix. The marker itself
	// becomes spaces rather than growing a second bullet.
	expect(canonicalizeMathFences(c('- $$x=\n  1$$'))).toBe('- $$\n  x=\n  1\n  $$');
	expect(canonicalizeMathFences(c('1. $$x=\n   1$$'))).toBe('1. $$\n   x=\n   1\n   $$');
	expect(canonicalizeMathFences(c('- 一\n  - $$x=\n    1$$\n- 三'))).toBe('- 一\n  - $$\n    x=\n    1\n    $$\n- 三');
	expect(canonicalizeMathFences(c('> $$x=\n> 1$$ 继续'))).toBe('> $$\n> x=\n> 1\n> $$\n> 继续');
	expect(canonicalizeMathFences(c('> > $$x=\n> > 1$$'))).toBe('> > $$\n> > x=\n> > 1\n> > $$');
	expect(canonicalizeMathFences(c('> - $$x=\n>   1$$'))).toBe('> - $$\n>   x=\n>   1\n>   $$');
});

test('a block whose container ends before its closer is left alone', () => {
	// The closing run is outside the list item, so where the block stops is not
	// something this pass can read off one line. It declines instead of guessing.
	expect(canonicalizeMathFences(c('- $$x=\n1$$'))).toBe('- $$x=\n1$$');
	expect(canonicalizeMathFences(c('> $$x=\n\n后文。'))).toBe('> $$x=\n\n后文。');
});

test('a fenced code block is not read at all', () => {
	for (const text of [
		'```\n$$x=\n1$$\n```',
		'~~~\n$$x=\n1$$\n~~~',
		'   ```js\n$$x=\n1$$\n   ```',
		'`$$x=\n1$$`',
		'a \\$\\$x\n y\\$\\$ b',
		// A fence opened after a list marker still opens a code block; missing it
		// leaves an unterminated fence that swallows the rest of the message.
		'1. ```python\n   x = "$$a"\n   ```',
	]) {
		expect(canonicalizeMathFences(c(text))).toBe(text);
	}
});

test('a fence after a list marker closes where it says it does', () => {
	const text = c('- ```py\n  x = 1\n  ```\n\n然后：\n\n$$S=\\begin{bmatrix}\n1&2\n\\end{bmatrix}$$\n\n完。');
	expect(tree(text)).toEqual([
		'code:x = 1',
		'p',
		'text:然后：',
		'math(S=\\begin{bmatrix}):1&2\n\\end{bmatrix}$$\n\n完。',
	]);
	expect(canonicalizeMathFences(text)).toBe(
		'- ```py\n  x = 1\n  ```\n\n然后：\n\n$$\nS=\\begin{bmatrix}\n1&2\n\\end{bmatrix}\n$$\n\n完。',
	);
	expect(tree(canonicalizeMathFences(text))).toEqual([
		'code:x = 1',
		'p',
		'text:然后：',
		'math():S=\\begin{bmatrix}\n1&2\n\\end{bmatrix}',
		'p',
		'text:完。',
	]);
});

test('a ``` inside a display block is content, to remark and to this pass', () => {
	// The block opened on the first line, so nothing until its closer opens a code
	// fence. Cutting the opener keeps the parse and gives the first line back.
	const text = c('$$a\n```\n$$\n```\nb$$');
	expect(tree(text)).toEqual(['math(a):```', 'code:b$$']);
	expect(canonicalizeMathFences(text)).toBe('$$\na\n```\n$$\n```\nb$$');
	expect(tree(canonicalizeMathFences(text))).toEqual(['math():a\n```', 'code:b$$']);
});

test('a code span at the start of a line is not an opener', () => {
	expect(canonicalizeMathFences(c('`$$` 是分隔符。\n$$x=1\ny=2\n$$'))).toBe('`$$` 是分隔符。\n$$\nx=1\ny=2\n$$');
});

test('a run whose closer has not arrived yet is escaped', () => {
	// Mid-stream. Left alone the cut opener would be a flow block that swallows
	// the rest of the reply; escaped, the half-written formula shows as the
	// source it is, and the escape is gone the moment the closing run arrives.
	const streaming = c('矩阵：\n$$S=\\begin{bmatrix}\n0.99');
	expect(canonicalizeMathFences(streaming)).toBe('矩阵：\n&#36;&#36;S=\\begin{bmatrix}\n0.99');
	expect(tree(canonicalizeMathFences(streaming))).toEqual(['p', 'text:矩阵：\n$$S=\\begin{bmatrix}\n0.99']);
	expect(canonicalizeMathFences(c('矩阵：\n$$S=1\n$$'))).toBe('矩阵：\n$$\nS=1\n$$');
});

test('the escape for a block still streaming writes no dollar of its own', () => {
	// `\$\$` would still carry two delimiters: mathText does not honour a
	// backslash before a closing dollar, so a lone `$` earlier in the paragraph
	// closes an inline span over the prose between them and paints it red. A
	// character reference is resolved after inline parsing, so its dollars are
	// never delimiters, and the reader still sees `$$`.
	const text = c('每股 $200\n$$S=\\begin{bmatrix}');
	expect(tree(text)).toEqual(['p', 'text:每股 $200', 'math(S=\\begin{bmatrix}):']);
	const fixed = canonicalizeMathFences(text);
	expect(fixed).toBe('每股 $200\n&#36;&#36;S=\\begin{bmatrix}');
	expect(tree(fixed)).toEqual(['p', 'text:每股 $200\n$$S=\\begin{bmatrix}']);
	const alone = c('&#36;&#36;S=\\begin{bmatrix}\n1&2');
	expect(tree(alone)).toEqual(['p', 'text:$$S=\\begin{bmatrix}\n1&2']);
	expect(canonicalizeMathFences(alone)).toBe(alone);
});

test('a run of three never closes on a run of two', () => {
	// remark refuses that pairing, so the block this would open never closes and
	// its opener is escaped instead of cut.
	expect(canonicalizeMathFences(c('$$$x=\n1$$'))).toBe('&#36;&#36;&#36;x=\n1$$');
	expect(canonicalizeMathFences(c('$$$x=\n1$$$'))).toBe('$$$\nx=\n1\n$$$');
});

test('a line-start run inside a block is content, not a closer', () => {
	// remark does not close on `$$ tail`, it swallows it, so neither does this
	// pass — which leaves the block open, and an open block gets its opener
	// escaped. The formula shows as source instead of as a wall of red.
	const text = c('$$x=1\ny=2\n$$ tail');
	expect(tree(text)).toEqual(['math(x=1):y=2\n$$ tail']);
	expect(canonicalizeMathFences(text)).toBe('&#36;&#36;x=1\ny=2\n&#36;&#36; tail');
	expect(tree(canonicalizeMathFences(text))).toEqual(['p', 'text:$$x=1\ny=2\n$$ tail']);
});

test('CRLF text stays CRLF', () => {
	expect(canonicalizeMathFences(c('$$x=\r\n1$$\r\n后文。'))).toBe('$$\r\nx=\r\n1\r\n$$\r\n后文。');
	// Per line, not per document: a CRLF terminator pushed into an LF-only part of
	// a mixed reply is a byte the model never wrote.
	expect(canonicalizeMathFences(c('$$x=\n1$$\r\n$$y=\n2$$'))).toBe('$$\nx=\n1\r\n$$\r\n$$\ny=\n2\n$$');
	// A lone `\r` is a line ending to CommonMark, so the pass keeps it, on the last
	// line and in the break it inserts there.
	expect(canonicalizeMathFences(c('$$x=\r\n1$$\r'))).toBe('$$\r\nx=\r\n1\r$$\r');
	// And reads it as one: this `$$` is alone on its line, so it opens a block
	// that is already canonical and stays untouched.
	const cr = c('价 $9\n$$\r- ');
	expect(tree(cr)).toEqual(['p', 'text:价 $9', 'math():- ']);
	expect(canonicalizeMathFences(cr)).toBe(cr);
});

test('an ordered marker other than 1. does not interrupt a paragraph', () => {
	// CommonMark lets only `1.` and `1)` open a list inside a paragraph, so this
	// is one paragraph whose formula is working inline math. Read as a list item
	// it would be cut into literal text beside an empty display block.
	const prose = c('公式如下：\n2. $$x=\n   1$$');
	expect(tree(prose)).toEqual(['p', 'text:公式如下：\n2. ', 'inlineMath:x=\n   1']);
	expect(canonicalizeMathFences(prose)).toBe(prose);
	// `1.` in the same place is a list, and it is broken.
	const first = c('公式如下：\n1. $$x=\n   1$$');
	expect(tree(first)).toEqual(['p', 'text:公式如下：', 'math(x=):1$$']);
	expect(canonicalizeMathFences(first)).toBe('公式如下：\n1. $$\n   x=\n   1\n   $$');
	expect(tree(canonicalizeMathFences(first))).toEqual(['p', 'text:公式如下：', 'math():x=\n1']);
	// So is `2.` where no paragraph is in the way: after a blank line, or beside
	// an item that is already open.
	const blank = c('公式如下：\n\n2. $$x=\n   1$$');
	expect(canonicalizeMathFences(blank)).toBe('公式如下：\n\n2. $$\n   x=\n   1\n   $$');
	expect(tree(canonicalizeMathFences(blank))).toEqual(['p', 'text:公式如下：', 'math():x=\n1']);
	const sibling = c('1. a\n2. $$x=\n   1$$');
	expect(canonicalizeMathFences(sibling)).toBe('1. a\n2. $$\n   x=\n   1\n   $$');
	expect(tree(canonicalizeMathFences(sibling))).toEqual(['p', 'text:a', 'math():x=\n1']);
});

test('five spaces after a list marker are an indented code block', () => {
	// Four is the most a marker may be followed by. The fifth space puts the
	// content in a code block inside the item, where a cut or an escape shows.
	const text = c('-' + ' '.repeat(5) + '$$x=\n' + ' '.repeat(7) + '1$$');
	expect(tree(text)).toEqual(['code:$$x=\n 1$$']);
	expect(canonicalizeMathFences(text)).toBe(text);
	// Four still opens the item, at its own column.
	expect(canonicalizeMathFences(c('-    $$x=\n     1$$'))).toBe('-    $$\n     x=\n     1\n     $$');
});

test('a raw HTML block is left as it is', () => {
	// Its content reaches the reader as written, so both the cut and the escape
	// would show. `<pre>` runs to its closing tag, everything else to a blank line.
	for (const text of [c('<div>\n$$S=a\nb'), c('<div>\n$$S=a\nb$$\n</div>'), c('<pre>\n\n$$S=a\nb$$\n</pre>')]) {
		expect(tree(text)).toEqual([`html:${text}`]);
		expect(canonicalizeMathFences(text)).toBe(text);
	}
	// The block ends at the blank line, and the formula after it is still cut.
	expect(canonicalizeMathFences(c('<div>\nx\n\n$$S=a\nb$$'))).toBe('<div>\nx\n\n$$\nS=a\nb\n$$');
});

test('a blockquote inside a list item is not repaired', () => {
	// The prefix reads quote markers before a list marker, not after one, so this
	// block is left exactly as the model wrote it: a missed repair, not a wrong cut.
	const text = c('- > $$S=a\n>   b$$');
	expect(tree(text)).toEqual(['math(S=a):', 'p', 'text:b$$']);
	expect(canonicalizeMathFences(text)).toBe(text);
});

// Whitespace-stripped and with the escape resolved, for the "nothing was
// deleted" invariant. The transform adds newlines, indentation and quote
// markers, and writes a still-open block's `$$` as `&#36;&#36;`; it never drops a
// character that carries meaning.
function dense(text: string): string {
	return text.replace(/&#36;/g, () => '$').replace(/\s+/g, '');
}

function isSubsequence(inner: string, outer: string): boolean {
	let i = 0;
	for (let j = 0; j < outer.length && i < inner.length; j += 1) if (inner[i] === outer[j]) i += 1;
	return i === inner.length;
}

test('the transform is a fixed point and deletes nothing', () => {
	for (const text of CASES) {
		const once = canonicalizeMathFences(text);
		expect(canonicalizeMathFences(once)).toBe(once);
		expect(isSubsequence(dense(text), dense(once))).toBe(true);
	}
});

test('a fixed point over random markdown too', () => {
	// A seeded walk over the tokens that decide the pass — containers, fences,
	// escapes, dollar runs of every length — because the cases above are the
	// shapes we thought of and the model writes the ones we did not.
	const tokens = [
		'$$',
		'$',
		'$$$',
		'$$$$',
		'\n',
		'\n\n',
		'\r\n',
		'a',
		'中',
		' ',
		'  ',
		'    ',
		'- ',
		'> ',
		'> > ',
		'1. ',
		'`',
		'```',
		'~~~',
		'\\$',
		'\\\\',
		'[p.5]',
		'\t',
		'x=1',
	];
	let seed = 12345;
	const next = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
	for (let n = 0; n < 20000; n += 1) {
		let text = '';
		const parts = 1 + Math.floor(next() * 14);
		for (let k = 0; k < parts; k += 1) text += tokens[Math.floor(next() * tokens.length)];
		const once = canonicalizeMathFences(text);
		expect(canonicalizeMathFences(once)).toBe(once);
		expect(isSubsequence(dense(text), dense(once))).toBe(true);
	}
});
