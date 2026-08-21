// Moving `$$` fences onto their own lines before remark-math reads them.
//
// remark-math's flow rule is strict in a way the model never obeys: a display
// block opens on a line whose `$$` is followed by nothing (anything else on that
// line becomes the node's `meta` and is dropped from the output), and it closes
// only on a line holding nothing but `$$`. The shape the model actually writes,
// `$$S=\begin{bmatrix}` … `\end{bmatrix}$$`, therefore opens a block that loses
// its first line, never closes, and swallows the rest of the reply into one red
// run of raw LaTeX. Every multi-line formula in the stored threads is written
// that way; not one is in the canonical form, under a prompt that already names
// the delimiters.
//
// That line is the only shape remark gets wrong, so it is the only one this pass
// touches. A `$$` alone on its line already opens and closes a block; a run
// anywhere but the start of a line is inline math, which spans newlines and
// renders as written; and a line-start run whose remainder holds a dollar at all
// is refused as flow and falls back to inline math, which renders too. Those
// come back byte for byte, as does everything the pass reads as code, as raw
// HTML, or as prose that only looks like a container. The bytes it does write
// are the two cuts on a broken block's own fence lines, the container prefix on
// the lines those cuts insert, and the escape below when such a block has no
// closer yet. Not every other byte is untouchable — a line-start `$$100 元。` is
// a block opener to remark and so to this pass — but a reply that already
// rendered clean is: everything the pass rewrites was painting the error colour
// before it.
//
// It is a line pass because remark's rules are container-relative: a flow block
// ends where the blockquote or list item that opened it ends, and no scan of
// `$$` runs can see that. Two cuts: the broken opening line becomes the run and
// then the rest of the line, the broken closing line becomes what came before it,
// then the run, then whatever followed. The exception is a block whose closer has
// not streamed in yet — its opening run becomes `&#36;&#36;`, because a block
// left open paints the rest of the reply red until the model finishes typing.

// The container matter a line may carry and still count as starting with what
// comes after it: blockquote markers, one list marker, and up to three spaces at
// each step, which is remark's own threshold for letting a flow construct open.
// A fourth space opens an indented code block, so a run behind that much
// whitespace never starts a line as far as this pass is concerned. The same
// threshold applies after a list marker, one space later: five spaces there put
// the content in an indented code block inside the item, and the lookahead makes
// the marker fail to match rather than swallow four of them and call the rest a
// line start.
const PREFIX = /^((?: {0,3}>[ \t]?)*)(?:( {0,3})((?:[-*+]|\d{1,9}[.)])[ \t]{1,4}(?![ \t])))?( {0,3})/;
// The same prefix without the list marker, for a marker that turns out to be
// prose.
const QUOTES = /^((?: {0,3}>[ \t]?)*)( {0,3})/;
// An ordered marker that cannot interrupt a paragraph: CommonMark lets only `1.`
// and `1)` do that.
const LATER_ITEM = /^(?!1[.)])\d/;
const FENCE = /^(`{3,}|~{3,})/;
// A raw HTML block reaches the reader as written, so a cut or an escape inside
// one is visible. `<script>`, `<pre>`, `<style>` and `<textarea>` run to their
// closing tag; every other kind ends at a blank line.
const HTML = /^</;
const HTML_RAW = /^<(script|pre|style|textarea)\b/i;
const RUN = /^\$\$+/;
const LEADING_SPACE = /^[ \t]*/;

interface Line {
	// The line without its terminator, the terminator it had, and the terminator
	// an inserted line break repeats. Per line rather than per document: a CRLF
	// pushed into an LF-only part of a mixed reply is a byte the model never
	// wrote. The last line has no terminator and borrows the one above it.
	text: string;
	eol: string;
	nl: string;
	// The container matter as written, and the form an inserted line repeats:
	// the list marker becomes spaces, so a new line continues the item instead of
	// opening a second one. Fences prefixed but body lines left lazy would split
	// the item and let the block escape the quote.
	prefix: string;
	cont: string;
	depth: number;
	// Leading whitespace, uncapped — for a line carrying a marker, the whitespace
	// before the marker.
	indent: number;
	// The column a later line has to reach to still be inside the list item this
	// one opens. Plain indentation is not a container, so a line without a marker
	// sets no column and anything after it is still in the same container.
	column: number;
	// The column a paragraph opened on this line would live at: the item's column
	// where the line carries a marker, the container's own otherwise. Indentation
	// alone opens no container, so an indented line raises no barrier.
	body: number;
	content: string;
}

// Whether a list marker really opens an item here. Only `1.` and `1)` may
// interrupt a paragraph, so `公式如下：\n2. $$x=\n   1$$` is one paragraph whose
// `$$` is working inline math; read as a list it would be cut into literal text
// beside an empty display block. `para` is the column of the open paragraph, or
// null where none is open.
function opensItem(marker: string, start: number, para: number | null): boolean {
	return !LATER_ITEM.test(marker) || para === null || start < para;
}

// A line's container matter, read against whatever paragraph is open above it.
// A marker that paragraph swallows is re-read as prose, which is what QUOTES is
// for: the line then carries no container and starts nothing.
function parseLine(text: string, eol: string, nl: string, para: number | null): Line {
	const m = PREFIX.exec(text) as RegExpExecArray;
	const quotes = m[1];
	const item = m[3] !== undefined && opensItem(m[3], quotes.length + (m[2] as string).length, para);
	const plain = item ? null : (QUOTES.exec(text) as RegExpExecArray);
	const marker = item ? (m[3] as string) : '';
	const before = item ? (m[2] as string) : '';
	const after = plain === null ? m[4] : plain[2];
	const prefix = plain === null ? m[0] : plain[0];
	const indent = item
		? before.length
		: (LEADING_SPACE.exec(text.slice(quotes.length)) as RegExpExecArray)[0].length;
	return {
		text,
		eol,
		nl,
		prefix,
		cont: quotes + before + ' '.repeat(marker.length) + after,
		depth: (quotes.match(/>/g) ?? []).length,
		indent,
		column: item ? indent + marker.length + after.length : 0,
		body: item ? prefix.length : quotes.length,
		content: text.slice(prefix.length),
	};
}

interface Cut {
	before: string;
	run: string;
	rest: string;
}

// The three pieces of a broken closing line — `\end{bmatrix}$$` and
// `\end{bmatrix}$$ 然后。` — which is a run of at least the opener's length with
// something before it on the line. A run with nothing before it is not a closer:
// remark reads that line as another opener and swallows it, and so does this pass.
function closerCut(line: Line, len: number): Cut | null {
	const { content } = line;
	let i = 0;
	while (i < content.length) {
		if (content[i] !== '$') {
			i += 1;
			continue;
		}
		let end = i;
		while (content[end] === '$') end += 1;
		// A backslash makes the dollar inert. Inside a formula it is LaTeX either
		// way, and cutting there would break the formula in half.
		const inert = i > 0 && content[i - 1] === '\\';
		if (!inert && end - i >= len && content.slice(0, i).trim() !== '') {
			return {
				before: line.text.slice(0, line.prefix.length + i),
				run: content.slice(i, end),
				rest: content.slice(end).replace(LEADING_SPACE, ''),
			};
		}
		i = end;
	}
	return null;
}

interface Block {
	open: number;
	// Whether the opening line has to be cut. A `$$` alone on its line opens the
	// same block and needs no edit.
	split: boolean;
	close: number | null;
	cut: Cut | null;
	ended: 'closer' | 'container' | 'eot';
}

interface Open {
	line: number;
	split: boolean;
	len: number;
	depth: number;
	column: number;
}

// Whether a line is still inside the container the block opened in. Getting this
// wrong ends the block early, which costs no more than the pass declining: a
// block cut short this way is left exactly as the model wrote it.
function holds(line: Line, open: Open): boolean {
	if (line.text.trim() === '') return open.depth === 0 && open.column === 0;
	return line.depth === open.depth && line.indent >= open.column;
}

// Where the display blocks are, reading the lines the way remark does: a code
// fence, a raw HTML block and a math block each swallow lines until their own
// end, and none can open inside another. Lines named in `escaped` open nothing,
// because the emit pass is about to turn their run into a literal.
function scan(lines: Line[], escaped: ReadonlySet<number>): { blocks: Block[]; escapes: number[] } {
	const blocks: Block[] = [];
	const escapes: number[] = [];
	let fence: { char: string; len: number } | null = null;
	// The closing tag an open HTML block waits for, or '' for one that ends at
	// the next blank line.
	let html: string | null = null;
	let open: Open | null = null;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (fence) {
			const f = FENCE.exec(line.content);
			if (f && f[1][0] === fence.char && f[1].length >= fence.len && line.content.slice(f[0].length).trim() === '')
				fence = null;
			continue;
		}
		if (html !== null) {
			if (html === '' ? line.text.trim() === '' : line.content.toLowerCase().includes(html)) html = null;
			continue;
		}
		if (open) {
			if (holds(line, open)) {
				const run = RUN.exec(line.content);
				if (run && run[0].length >= open.len && line.content.slice(run[0].length).trim() === '') {
					blocks.push({ open: open.line, split: open.split, close: i, cut: null, ended: 'closer' });
					open = null;
					continue;
				}
				const cut = closerCut(line, open.len);
				if (cut) {
					blocks.push({ open: open.line, split: open.split, close: i, cut, ended: 'closer' });
					open = null;
					continue;
				}
				continue;
			}
			blocks.push({ open: open.line, split: open.split, close: null, cut: null, ended: 'container' });
			open = null;
		}
		const f = FENCE.exec(line.content);
		if (f) {
			fence = { char: f[1][0], len: f[1].length };
			continue;
		}
		if (HTML.test(line.content)) {
			const raw = HTML_RAW.exec(line.content);
			html = raw ? `</${raw[1].toLowerCase()}` : '';
			if (html !== '' && line.content.toLowerCase().includes(html)) html = null;
			continue;
		}
		if (escaped.has(i)) {
			escapes.push(i);
			continue;
		}
		const run = RUN.exec(line.content);
		if (!run) continue;
		const len = run[0].length;
		const rest = line.content.slice(len);
		if (rest.trim() === '') {
			open = { line: i, split: false, len, depth: line.depth, column: line.column };
			continue;
		}
		// micromark refuses the flow block on the first dollar it meets in the
		// meta, whatever the run it belongs to, and reads the line as inline math
		// instead — which renders, so the line is not ours. `$$ 表示块公式，$ 表示
		// 行内公式。` is an ordinary sentence, not a broken opener.
		if (rest.includes('$')) continue;
		open = { line: i, split: true, len, depth: line.depth, column: line.column };
	}
	if (open) blocks.push({ open: open.line, split: open.split, close: null, cut: null, ended: 'eot' });
	return { blocks, escapes };
}

// One walk of the lines. Not the whole transform: cutting a closing line can put
// what was mid-line at the start of a line, where the same rules read it
// differently, so canonicalizeMathFences repeats this until it settles.
function pass(text: string): string {
	if (!text.includes('$$')) return text;
	// CommonMark ends a line on CRLF, LF or a lone CR alike, and reading a lone CR
	// as text would make the pass see a `$$` mid-line where remark sees one at the
	// start of a line. The capture group keeps each terminator with its own line.
	const raw = text.split(/(\r\n|\n|\r)/);
	// A paragraph is open from the first non-blank line until the next blank one,
	// and where it sits decides whether a later ordered marker is a marker at all.
	const lines: Line[] = [];
	let para: number | null = null;
	let nl = '\n';
	for (let i = 0; i < raw.length; i += 2) {
		const eol = raw[i + 1] ?? '';
		if (eol !== '') nl = eol;
		const line = parseLine(raw[i], eol, nl, para);
		lines.push(line);
		para = line.text.trim() === '' ? null : (para ?? line.body);
	}

	// Escaping an opener takes its block away, which changes what the lines after
	// it belong to, so the scan is repeated until no cut opener is left hanging.
	// Each round escapes at least one more line, and an escaped line never opens
	// a block again.
	const escaped = new Set<number>();
	let scanned = scan(lines, escaped);
	for (;;) {
		const hanging = scanned.blocks.filter((b) => b.split && b.ended === 'eot');
		if (hanging.length === 0) break;
		for (const block of hanging) escaped.add(block.open);
		scanned = scan(lines, escaped);
	}

	const rewritten = new Map<number, string[]>();
	for (const at of scanned.escapes) {
		// A `$$` whose closer has not arrived yet. Left as it is, it opens a flow
		// block that eats its own opening line and paints everything after it red
		// for as long as the formula streams. The replacement is a character
		// reference rather than `\$\$`: mathText does not honour a backslash before
		// a dollar, so `\$\$` still carries two delimiters and a lone `$` earlier in
		// the paragraph closes an inline span over the prose between them. A
		// character reference is resolved after inline parsing, so its dollars are
		// never delimiters, and the reader sees `$$`. It is self-cancelling either
		// way: every render recomputes from the model's text, so it is gone the
		// moment the closing run arrives.
		const line = lines[at];
		const run = (RUN.exec(line.content) as RegExpExecArray)[0];
		rewritten.set(at, [line.prefix + '&#36;'.repeat(run.length) + line.content.slice(run.length)]);
	}
	for (const block of scanned.blocks) {
		// A block whose container ended before its closer is left exactly as the
		// model wrote it: the pass declines rather than guess where it stopped.
		if (block.ended !== 'closer') continue;
		const open = lines[block.open];
		if (block.split) {
			const run = (RUN.exec(open.content) as RegExpExecArray)[0];
			rewritten.set(block.open, [
				open.prefix + run,
				open.cont + open.content.slice(run.length).replace(LEADING_SPACE, ''),
			]);
		}
		if (block.cut) {
			const pieces = [block.cut.before, open.cont + block.cut.run];
			if (block.cut.rest !== '') pieces.push(open.cont + block.cut.rest);
			rewritten.set(block.close as number, pieces);
		}
	}
	if (rewritten.size === 0) return text;

	let out = '';
	for (let i = 0; i < lines.length; i += 1) {
		const pieces = rewritten.get(i);
		out += (pieces === undefined ? lines[i].text : pieces.join(lines[i].nl)) + lines[i].eol;
	}
	return out;
}

export function canonicalizeMathFences(text: string): string {
	// Each round either breaks a line in two or turns a run into a literal, and
	// neither can be undone by a later round, so this settles rather than cycles.
	// Real replies settle on the first round; a second one only ever has the
	// pieces the first round created to look at.
	let out = text;
	for (;;) {
		const next = pass(out);
		if (next === out) return out;
		out = next;
	}
}
