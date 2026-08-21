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
// Only a run that starts its own line reaches that rule. A run anywhere else on
// the line is inline math, which spans newlines and renders as written, so the
// scope here is one shape: a pair whose opening run starts its line and whose
// content crosses a newline. Its two fences move onto lines of their own; every
// other run in the text comes back byte for byte.

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

// The container matter a line may carry and still count as starting with what
// comes after it: blockquote markers, one list marker, and up to three spaces at
// each step, which is remark's own threshold for letting a flow construct open.
// A fourth space opens an indented code block instead.
const PREFIX = /^((?: {0,3}>[ \t]?)*)(?:( {0,3})((?:[-*+]|\d{1,9}[.)])[ \t]+))?( {0,3})/;
const FENCE = /^(`{3,}|~{3,})/;
const MATH_LINE = /^(\$\$+)[ \t\r]*$/;
const BLANK_LINE = /\n[ \t]*\n/;
const LEADING_SPACE = /^[ \t]*/;

function afterPrefix(line: string): string {
	return line.slice(PREFIX.exec(line)?.[0].length ?? 0);
}

// The prefix every line inserted for a run has to repeat, or null when the run
// does not start its own line. Fences prefixed but body lines left lazy splits
// the list item and lets the block escape the quote. The list marker becomes
// spaces, so an inserted line continues the item instead of opening a second one.
function openerPrefix(text: string, at: number): string | null {
	const head = text.slice(text.lastIndexOf('\n', at - 1) + 1, at);
	const m = PREFIX.exec(head);
	if (!m || m[0].length !== head.length) return null;
	return m[1] + (m[2] ?? '') + ' '.repeat(m[3]?.length ?? 0) + m[4];
}

// Which lines sit inside a fenced code block. A fence opens on a line whose
// container prefix is followed by three or more backticks or tildes (the info
// string is irrelevant) and closes on a line with the same character, at least
// as long, and nothing but whitespace after the run. An unterminated fence runs
// to the end of the text: mid-stream that is exactly right, and it keeps a
// half-written block from being rewritten.
//
// Indented (four-space) code blocks are not modeled — telling one from a lazy
// list continuation needs container context this pass does not have. Nothing
// inside one is rewritten anyway: openerPrefix does not admit that much
// indentation.
//
// A display block already in canonical form is the one thing that can hold a
// fence line without opening a code block, exactly as remark reads it: `$$`
// alone opens a flow block whose lines are all content until a line of nothing
// but `$$`. Without that state, running this function over its own output would
// find a code fence in a formula and reach a different pairing than the pass
// that wrote it.
function fencedLines(text: string): boolean[] {
	const flags: boolean[] = [];
	let open: { char: string; len: number } | null = null;
	let math: number | null = null;
	for (const line of text.split('\n')) {
		const rest = afterPrefix(line);
		const m = FENCE.exec(rest);
		if (open) {
			flags.push(true);
			const closes =
				m !== null && m[1][0] === open.char && m[1].length >= open.len && rest.slice(m[0].length).trim() === '';
			if (closes) open = null;
			continue;
		}
		const alone = MATH_LINE.exec(rest);
		if (math !== null) {
			flags.push(false);
			if (alone && alone[1].length >= math) math = null;
			continue;
		}
		if (alone) {
			math = alone[1].length;
			flags.push(false);
			continue;
		}
		if (m) open = { char: m[1][0], len: m[1].length };
		flags.push(m !== null);
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

// One rewrite the output pass has to make, in the order the offsets come.
type Edit =
	| { at: number; kind: 'block'; open: Run; close: Run; prefix: string }
	| { at: number; kind: 'escape'; run: Run };

export function canonicalizeMathFences(text: string): string {
	if (!text.includes('$$')) return text;
	const fenced = fencedLines(text);
	const { pairs, unpaired } = pairRuns(text, scanRuns(text, fenced));
	const edits: Edit[] = [];
	for (const { open, close } of pairs) {
		const prefix = openerPrefix(text, open.start);
		if (prefix === null) continue;
		// A single-line pair is inline math and renders as it is; a pair with one
		// line inside a fenced block has that end in code.
		if (!text.slice(open.end, close.start).includes('\n')) continue;
		if (fencedBetween(fenced, open.line, close.line)) continue;
		edits.push({ at: open.start, kind: 'block', open, close, prefix });
	}
	for (const run of unpaired) {
		if (openerPrefix(text, run.start) !== null) edits.push({ at: run.start, kind: 'escape', run });
	}
	if (edits.length === 0) return text;
	edits.sort((a, b) => a.at - b.at);
	const nl = text.includes('\r\n') ? '\r\n' : '\n';
	let out = '';
	let last = 0;
	for (const edit of edits) {
		if (edit.kind === 'escape') {
			// A `$$` whose closer has not arrived yet. Left as it is, it opens a
			// flow block that eats its own opening line and paints everything after
			// it red for as long as the formula streams; escaped, the half-written
			// formula shows as the source the model is writing. The escape is
			// invisible (markdown eats the backslash) and self-cancelling: every
			// render recomputes from the model's text, so it is gone the moment the
			// closing run arrives.
			out += text.slice(last, edit.run.start) + '\\$'.repeat(edit.run.len);
			last = edit.run.end;
			continue;
		}
		const { open, close, prefix } = edit;
		out += text.slice(last, open.end) + nl;
		for (const line of bodyLines(text.slice(open.end, close.start), prefix)) {
			out += prefix + line + nl;
		}
		out += prefix + text.slice(close.start, close.end);
		// The closing line must hold nothing but the run, so whatever followed it
		// moves to a line of its own.
		const rest = text.slice(close.end, lineEnd(text, close.end));
		if (rest.trim() === '') {
			last = close.end;
			continue;
		}
		out += nl + prefix;
		last = close.end + (LEADING_SPACE.exec(rest)?.[0].length ?? 0);
	}
	return out + text.slice(last);
}
