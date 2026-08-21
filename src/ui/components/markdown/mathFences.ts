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
// So the source is canonicalized here instead: the fences move onto their own
// lines and everything else stays byte for byte. Single-line `$$x$$` pairs are
// left alone — remark reads those as inline math and they render today, and
// promoting them to display blocks would restyle every stored formula.
//
// Self-contained rather than sharing anchors.ts's codeRanges: this needs one
// left-to-right pass that interleaves escapes, backtick spans and dollar runs
// and hands back the runs' offsets, which a list of ranges cannot give.

// A run of one or more `$` and the line it sits on. The line is recorded by the
// scanner rather than recomputed later, so telling a pair that straddles a
// fenced code block from one that does not costs nothing.
interface Run {
	start: number;
	end: number;
	len: number;
	line: number;
}

interface Pair {
	open: Run;
	close: Run;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CONTAINER = /^(?:[ \t]*>[ \t]?)*[ \t]*/;
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const BLANK_LINE = /\n[ \t]*\n/;
const TRAILING_SPACE = /[ \t]+$/;
const LEADING_SPACE = /^[ \t]*/;

// Which lines sit inside a fenced code block. A fence opens on a line starting
// with three or more backticks or tildes (the info string is irrelevant) and
// closes on a line with the same character, at least as long, and nothing but
// whitespace after the run. An unterminated fence runs to the end of the text:
// mid-stream that is exactly right, and it keeps a half-written block from being
// rewritten.
//
// Indented (four-space) code blocks are not modeled — telling one from a lazy
// list continuation needs container context this pass does not have. The failure
// is bounded: a rewrite inside one only inserts newlines carrying the line's own
// indentation, so the block stays a code block.
function fencedLines(text: string): boolean[] {
	const flags: boolean[] = [];
	let open: { char: string; len: number } | null = null;
	for (const line of text.split('\n')) {
		const m = FENCE.exec(line);
		if (!open) {
			if (m) open = { char: m[1][0], len: m[1].length };
			flags.push(m !== null);
			continue;
		}
		flags.push(true);
		const closes =
			m !== null && m[1][0] === open.char && m[1].length >= open.len && line.slice(m[0].length).trim() === '';
		if (closes) open = null;
	}
	return flags;
}

function runEnd(text: string, at: number, char: string): number {
	let i = at;
	while (text[i] === char) i += 1;
	return i;
}

// Where a code span opened by `n` backticks closes: the next run of exactly n
// backticks, fenced lines skipped. Null when it never closes, in which case the
// backticks were literal.
function closingTicks(
	text: string,
	from: number,
	fromLine: number,
	n: number,
	fenced: boolean[],
): { at: number; line: number } | null {
	let i = from;
	let line = fromLine;
	while (i < text.length) {
		if (fenced[line]) {
			const nl = text.indexOf('\n', i);
			if (nl === -1) return null;
			i = nl + 1;
			line += 1;
			continue;
		}
		const ch = text[i];
		if (ch === '\n') {
			i += 1;
			line += 1;
			continue;
		}
		if (ch === '`') {
			const end = runEnd(text, i, '`');
			if (end - i === n) return { at: end, line };
			i = end;
			continue;
		}
		i += 1;
	}
	return null;
}

// Every `$` run that markdown will read as text. One pass, because what a
// character means depends on what came before it: a backslash makes the next
// character inert, so `\$\$` stays a literal the model asked for, and a code
// span is a stretch where no delimiter counts at all.
function scanRuns(text: string, fenced: boolean[]): Run[] {
	const runs: Run[] = [];
	let i = 0;
	let line = 0;
	while (i < text.length) {
		if (fenced[line]) {
			const nl = text.indexOf('\n', i);
			if (nl === -1) break;
			i = nl + 1;
			line += 1;
			continue;
		}
		const ch = text[i];
		if (ch === '\n') {
			i += 1;
			line += 1;
			continue;
		}
		if (ch === '\\') {
			// A backslash before a newline is a hard break; it escapes nothing.
			i += text[i + 1] === '\n' ? 1 : 2;
			continue;
		}
		if (ch === '`') {
			const spanStart = runEnd(text, i, '`');
			const close = closingTicks(text, spanStart, line, spanStart - i, fenced);
			if (!close) {
				i = spanStart;
				continue;
			}
			i = close.at;
			line = close.line;
			continue;
		}
		if (ch === '$') {
			const end = runEnd(text, i, '$');
			runs.push({ start: i, end, len: end - i, line });
			i = end;
			continue;
		}
		i += 1;
	}
	return runs;
}

// remark's pairing, measured: a run of two or more `$` opens flow math and
// closes on a run at least as long (open-3 never closes on close-2), and a lone
// `$` opens inline math that closes on another lone `$`. Following it exactly is
// what keeps this from rewriting text remark would not read as math.
function pairRuns(text: string, runs: Run[]): { pairs: Pair[]; unpaired: Run[] } {
	const pairs: Pair[] = [];
	const unpaired: Run[] = [];
	let i = 0;
	while (i < runs.length) {
		const run = runs[i];
		if (run.len === 1) {
			// Inline math is not ours, but its span has to be jumped: that is what
			// leaves the `$$` in `$x $$ y$` alone. A lone `$` that closes nothing is
			// a dollar sign in prose and the scan carries on past it.
			let j = i + 1;
			while (j < runs.length && runs[j].len !== 1) j += 1;
			const closes = j < runs.length && !BLANK_LINE.test(text.slice(run.end, runs[j].start));
			i = closes ? j + 1 : i + 1;
			continue;
		}
		let j = i + 1;
		while (j < runs.length && runs[j].len < run.len) j += 1;
		if (j < runs.length) {
			pairs.push({ open: run, close: runs[j] });
			i = j + 1;
			continue;
		}
		unpaired.push(run);
		i += 1;
	}
	return { pairs, unpaired };
}

// The container matter a line carries — blockquote markers and indentation, plus
// one list marker — and the column where the line's own content starts. Every
// inserted line repeats this prefix: fences prefixed but body lines left lazy
// splits the list item and lets the block escape the quote. The list marker
// becomes spaces, so an inserted line continues the item instead of opening a
// second one.
function containerOf(line: string): { prefix: string; contentAt: number } {
	const quote = CONTAINER.exec(line)?.[0] ?? '';
	const marker = LIST_MARKER.exec(line.slice(quote.length));
	if (!marker) return { prefix: quote, contentAt: quote.length };
	return { prefix: quote + ' '.repeat(marker[0].length), contentAt: quote.length + marker[0].length };
}

// The block's content, one output line each. The first segment sits on the
// opening line and is written as it stands; every later one has whatever
// container matter it already carries stripped, which both re-indents a lazy
// continuation line and keeps a marker the model did write from doubling.
function bodyLines(body: string, prefix: string): string[] {
	const lines = body.split(/\r?\n/);
	if (prefix !== '') {
		const quotes = (prefix.match(/>/g) ?? []).length;
		const lastQuote = prefix.lastIndexOf('>');
		const spaces = lastQuote === -1 ? prefix.length : prefix.length - lastQuote - 1;
		const strip = new RegExp(`^(?:[ \\t]*>[ \\t]?){0,${quotes}}[ \\t]{0,${spaces}}`);
		for (let i = 1; i < lines.length; i += 1) lines[i] = lines[i].replace(strip, '');
	}
	// The model usually already broke the line after the opening fence, and the
	// blank at the end is the closing fence's own line.
	if (lines.length > 0 && lines[0].trim() === '') lines.shift();
	if (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
	return lines;
}

function lineEnd(text: string, at: number): number {
	const nl = text.indexOf('\n', at);
	return nl === -1 ? text.length : nl;
}

function fencedBetween(fenced: boolean[], from: number, to: number): boolean {
	for (let line = from; line <= to; line += 1) if (fenced[line]) return true;
	return false;
}

export function canonicalizeMathFences(text: string): string {
	if (!text.includes('$$')) return text;
	const fenced = fencedLines(text);
	const { pairs } = pairRuns(text, scanRuns(text, fenced));
	// Only a pair whose content crosses a newline is ours, and only when no line
	// of it is inside a fenced code block — a pair straddling a fence has one
	// end in code and is left byte-identical.
	const blocks = pairs.filter(
		(p) =>
			text.slice(p.open.end, p.close.start).includes('\n') &&
			!fencedBetween(fenced, p.open.line, p.close.line),
	);
	if (blocks.length === 0) return text;
	const nl = text.includes('\r\n') ? '\r\n' : '\n';
	let out = '';
	let last = 0;
	for (const block of blocks) {
		out += text.slice(last, block.open.start);
		// The line as it stands in the output, not in the input: a pair earlier on
		// the same line may already have been rewritten.
		const tail = out.slice(out.lastIndexOf('\n') + 1);
		const { prefix, contentAt } = containerOf(tail);
		if (tail.slice(contentAt).trim() !== '') {
			// Right-trimmed first, or the spaces that separated the prose from the
			// fence become a two-space hard break at the end of the line.
			out = out.replace(TRAILING_SPACE, '') + nl + prefix;
		}
		out += text.slice(block.open.start, block.open.end) + nl;
		for (const line of bodyLines(text.slice(block.open.end, block.close.start), prefix)) {
			out += prefix + line + nl;
		}
		out += prefix + text.slice(block.close.start, block.close.end);
		// The closing line must hold nothing but the run, so whatever followed it
		// moves to a line of its own.
		const rest = text.slice(block.close.end, lineEnd(text, block.close.end));
		if (rest.trim() === '') {
			last = block.close.end;
			continue;
		}
		out += nl + prefix;
		last = block.close.end + (LEADING_SPACE.exec(rest)?.[0].length ?? 0);
	}
	return out + text.slice(last);
}
