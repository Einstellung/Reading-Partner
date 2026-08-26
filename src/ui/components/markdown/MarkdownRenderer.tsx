// Heavy Markdown implementation: react-markdown + GitHub-flavored extensions,
// math (KaTeX), and code syntax highlighting. This module (and its CSS) is the
// bulk of the markdown payload, so it is loaded lazily — see Markdown.tsx, which
// code-splits it behind React.lazy and shows the raw text until it resolves.
//
// Security: no rehype-raw. react-markdown escapes raw HTML by default, which is
// what we want — model output is untrusted.
//
// Offline: KaTeX CSS/fonts and the highlight theme are bundled locally, never
// from a CDN (this is a desktop app that must work offline). Vite emits the
// KaTeX woff2 fonts as assets from the CSS url() references, alongside this
// module's async chunk.

import { useContext, useMemo, type AnchorHTMLAttributes, type HTMLAttributes } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import { linkifyCitations, linkifyFigureCitations, parseCitationHref } from '../../../reading/prep/anchors';
import { linkActionFor, openExternal } from '../../../platform/app/external-link';
import {
	CitationContext,
	FigureContext,
	PrepSlugContext,
	QuoteCheckContext,
	type CitationHandler,
} from './Markdown';
import { quotedCitationParagraph, type QuotedCitation } from './citationBlock';
import { remarkPlugins } from './remarkPlugins';
import { canonicalizeMathFences } from './mathFences';
import FigureCard from './FigureCard';
import { HIT_44 } from '../base/buttons';

// Module-level constant so the array isn't recreated each render. The remark
// half lives in remarkPlugins.ts, which the markdown tests import too.
const rehypePlugins = [rehypeHighlight, rehypeKatex];

// The citation chip. It sits in a line of prose but it is a control, not a run
// of words: its own background, radius and padding draw it as one, and it is the
// way back to the page a note or a reply came from. At 18–22px tall it is far
// under a finger, so it takes HIT_44 — a centred pseudo-element carries the
// target, which is why `relative` here costs the line box nothing.
const CITATION_CHIP = [
	'relative !no-underline rounded bg-[#efecfb] px-[0.25em] py-[0.125em] !text-[#4a3a9e] text-[0.9em] hover:bg-[#e2dcf6]',
	HIT_44,
].join(' ');

// The quote block: a citation that is a paragraph of its own and carries the
// book's words, drawn as one line of the book rather than a chip that hides it
// (see citationBlock.ts for when this is reached). It is the chip's palette
// pulled apart — the chip's fill becomes the hover state so the resting block
// sits lighter than a control in a line of prose, and the chip's ink becomes
// the rule down the left edge and the source marker under the quote.
//
// The quote itself keeps the body size. It is text to read, the only book text
// a reader who has not opened the book will see, so shrinking it into a
// footnote would be reading it wrong; only the marker under it steps down.
//
// The whole block is the target — a paragraph-wide box, so nothing here needs
// HIT_44's centred pseudo-element (which would in any case be the wrong shape
// for a box already taller than a line). Padding alone carries it past 44px:
// in the 12px reader panels the two lines plus their gap are ~37px and the
// 0.5em of padding above and below adds 12 more, and every part of that scales
// with the container's font size rather than being calibrated for 16px.
const QUOTE_BLOCK =
	'my-[0.5em] flex w-full cursor-pointer flex-col items-start gap-[0.25em] rounded-r border-l-2 border-[#4a3a9e] bg-[#f6f4fd] px-[0.75em] py-[0.5em] text-left can-hover:hover:bg-[#efecfb]';

function QuoteBlock({ quoted, onCitation }: { quoted: QuotedCitation; onCitation: CitationHandler }) {
	return (
		<button type="button" className={QUOTE_BLOCK} onClick={() => onCitation(quoted.citation)}>
			{/* No quotation marks around it: the block is already the mark, and a
			    pair added here would double the ones a CJK reply writes. */}
			<span className="text-neutral-700">{quoted.quote}</span>
			{quoted.label ? <span className="text-[0.85em] text-[#4a3a9e]">{quoted.label}</span> : null}
		</button>
	);
}

// Paragraphs. Nearly all of them are just <p>; the exception is a paragraph
// holding nothing but one quoted citation, which becomes the block above.
//
// Only <p> is overridden, so a citation inside a list item keeps the inline
// chip. That is not a gap to fill later: the block wants the full content width
// and a list already owns an indent and a marker, and the prompt asks for a
// quoted citation to stand as its own paragraph.
function makeParagraph(onCitation: CitationHandler | null) {
	return function Paragraph({ children, node, ...rest }: HTMLAttributes<HTMLParagraphElement> & ExtraProps) {
		const verifyQuote = useContext(QuoteCheckContext);
		const quoted = onCitation ? quotedCitationParagraph(node) : null;
		// A paper citation has no full text on this side to check against, so it
		// is shown as written; a page citation is checked when there is anything
		// to check with, and a quote that isn't on its page keeps the chip.
		const trusted =
			quoted !== null &&
			(quoted.citation.kind !== 'page' || !verifyQuote || verifyQuote(quoted.citation.page, quoted.quote));
		if (quoted && trusted && onCitation) return <QuoteBlock quoted={quoted} onCitation={onCitation} />;
		return <p {...rest}>{children}</p>;
	};
}

// Citation links ([p.12] rewritten to #rp-… hrefs by linkifyCitations) render
// as quiet chips that call back into the host instead of navigating. Every
// other link is a link the model wrote, and none of them may navigate the
// webview: that would replace the app (docs/pitfall/94). A web link opens in
// the system browser, anything that would reload our own page does nothing.
//
// A figure is read back whenever there is a figure host, handler or not: the
// card is a picture that opens where it stands, so it needs nothing to jump to.
// The other shapes are jumps, so they are only read back when someone can take
// one — and a citation href with no handler prints its own text rather than an
// anchor nothing answers. Reached only for a link the model wrote as a link,
// since without a handler nothing else is rewritten into one.
//
// `node` is the hast node react-markdown hands every custom component; it is
// named here so the spreads below drop it instead of writing it to the DOM.
function makeAnchor(onCitation: CitationHandler | null) {
	return function Anchor({ href, children, node, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
		const figureHost = useContext(FigureContext);
		const citation = onCitation || figureHost ? parseCitationHref(href) : null;
		// A [fig:N] citation renders as an inline card when a figure host is
		// available; otherwise it falls through to the quiet chip below (which
		// still jumps via onCitation).
		if (citation?.kind === 'figure' && figureHost) {
			return <FigureCard host={figureHost} id={citation.id} />;
		}
		if (!citation) {
			return (
				<a
					href={href}
					{...rest}
					onClick={(e) => {
						const action = linkActionFor(href);
						if (action.kind === 'pass') return;
						e.preventDefault();
						if (action.kind === 'external') openExternal(action.url);
					}}
				>
					{children}
				</a>
			);
		}
		if (!onCitation) return <>{children}</>;
		return (
			<a
				href={href}
				{...rest}
				className={CITATION_CHIP}
				onClick={(e) => {
					e.preventDefault();
					onCitation?.(citation);
				}}
			>
				{children}
			</a>
		);
	};
}

// A quiet, chat-density typography set. Tailwind arbitrary variants keep it all
// in one place; preflight strips the browser defaults, so every block element is
// styled explicitly here rather than relying on a base reset. Font size and
// color inherit from the bubble so the same component fits the narrow bubble and
// the wide full-window view.
//
// Sizes and spacing are both em, so the whole set is measured against whatever
// font size the row hands it: the 12px reader panels and a chat window zoomed to
// 1.8x get the same proportions rather than one rhythm calibrated for 16px. That
// is also why nothing here knows about --chat-scale.
const MD = [
	'text-[inherit] leading-relaxed break-words',
	// Outer edges hug the bubble padding; inner rhythm is compact.
	'[&>:first-child]:mt-0 [&>:last-child]:mb-0',
	// Paragraphs.
	'[&_p]:my-[0.5em]',
	// Headings — modest scale, this is a chat reply not a document.
	'[&_h1]:mb-[0.375em] [&_h1]:mt-[0.75em] [&_h1]:text-[1.2em] [&_h1]:font-semibold',
	'[&_h2]:mb-[0.375em] [&_h2]:mt-[0.75em] [&_h2]:text-[1.1em] [&_h2]:font-semibold',
	'[&_h3]:mb-[0.25em] [&_h3]:mt-[0.625em] [&_h3]:text-[1.05em] [&_h3]:font-semibold',
	'[&_h4]:mb-[0.25em] [&_h4]:mt-[0.5em] [&_h4]:font-semibold',
	'[&_h5]:mb-[0.25em] [&_h5]:mt-[0.5em] [&_h5]:font-semibold',
	'[&_h6]:mb-[0.25em] [&_h6]:mt-[0.5em] [&_h6]:font-semibold [&_h6]:text-neutral-500',
	// Lists.
	'[&_ul]:my-[0.5em] [&_ul]:list-disc [&_ul]:pl-[1.25em]',
	'[&_ol]:my-[0.5em] [&_ol]:list-decimal [&_ol]:pl-[1.25em]',
	'[&_li]:my-[0.125em]',
	'[&_li>ul]:my-[0.25em] [&_li>ol]:my-[0.25em]',
	// Inline code.
	'[&_code]:rounded [&_code]:bg-black/[0.06] [&_code]:px-[0.25em] [&_code]:py-[0.125em] [&_code]:font-mono [&_code]:text-[0.9em]',
	// Code blocks — own the background so the highlight theme only paints tokens.
	// The fill is whatever surface encloses this renderer (--chat-code-bg); the
	// reader panels set nothing and fall back to --muted-faint, which follows
	// the ground when the paper tint turns it warm.
	'[&_pre]:my-[0.5em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-black/10 [&_pre]:bg-[var(--chat-code-bg,var(--color-muted-faint))] [&_pre]:p-[0.75em] [&_pre]:leading-normal',
	'[&_pre_code]:!bg-transparent [&_pre_code]:!p-0 [&_pre_code]:font-mono [&_pre_code]:text-[0.85em]',
	// Blockquote.
	'[&_blockquote]:my-[0.5em] [&_blockquote]:border-l-2 [&_blockquote]:border-black/15 [&_blockquote]:pl-[0.75em] [&_blockquote]:text-neutral-500',
	// Tables (gfm) — scroll horizontally rather than overflow the bubble.
	'[&_table]:my-[0.5em] [&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[0.9em]',
	'[&_th]:border [&_th]:border-black/15 [&_th]:bg-black/[0.03] [&_th]:px-[0.5em] [&_th]:py-[0.25em] [&_th]:text-left [&_th]:font-semibold',
	'[&_td]:border [&_td]:border-black/15 [&_td]:px-[0.5em] [&_td]:py-[0.25em]',
	// Misc inline/blocks.
	'[&_a]:text-blue-600 [&_a]:underline',
	'[&_strong]:font-semibold',
	'[&_hr]:my-[0.75em] [&_hr]:border-black/10',
	'[&_img]:max-w-full [&_img]:rounded',
	// Display math can be wide; let it scroll within its own line.
	'[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-[0.25em]',
].join(' ');

export default function MarkdownRenderer({ text }: { text: string }) {
	const onCitation = useContext(CitationContext);
	const prepSlugs = useContext(PrepSlugContext);
	const figureHost = useContext(FigureContext);
	// The fences are canonicalized whether or not there is a citation host, and
	// before linkify: the scanner should see the model's own bytes. The order is
	// free either way — linkify inserts no `$`, no backtick and no newline, and
	// the newlines this inserts cannot split a citation bracket, since a bracket
	// holding a newline was never a candidate.
	//
	// With figures but no handler (a retell, a rehearsal note, the coach) only
	// the figure brackets are rewritten: a page citation there stays the text
	// the model wrote, exactly as it did before figures reached these surfaces.
	const source = useMemo(() => {
		const math = canonicalizeMathFences(text);
		if (onCitation) return linkifyCitations(math, prepSlugs);
		return figureHost ? linkifyFigureCitations(math) : math;
	}, [text, onCitation, prepSlugs, figureHost]);
	// The anchor override is installed whether or not there is a citation host:
	// without it, a plain link in a reply navigates the webview away from the app.
	const components = useMemo<Components>(
		() => ({ a: makeAnchor(onCitation), p: makeParagraph(onCitation) }),
		[onCitation],
	);
	return (
		<div className={MD}>
			<ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
				{source}
			</ReactMarkdown>
		</div>
	);
}
