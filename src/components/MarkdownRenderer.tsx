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

import { useContext, useMemo, type AnchorHTMLAttributes } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import { linkifyCitations, parseCitationHref } from '../prep/anchors';
import { CitationContext, type CitationHandler } from './Markdown';

// Module-level constants so the plugin arrays aren't recreated each render.
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeHighlight, rehypeKatex];

// Citation links ([p.12] rewritten to #rp-… hrefs by linkifyCitations) render
// as quiet chips that call back into the host instead of navigating; every
// other link keeps the default anchor behavior.
function makeAnchor(onCitation: CitationHandler) {
	return function Anchor({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
		const citation = parseCitationHref(href);
		if (!citation) {
			return (
				<a href={href} {...rest}>
					{children}
				</a>
			);
		}
		return (
			<a
				href={href}
				{...rest}
				className="!no-underline rounded bg-[#efecfb] px-1 py-0.5 !text-[#4a3a9e] text-[0.9em] hover:bg-[#e2dcf6]"
				onClick={(e) => {
					e.preventDefault();
					onCitation(citation);
				}}
			>
				{children}
			</a>
		);
	};
}

// A quiet, chat-density typography set. Tailwind arbitrary variants keep it all
// in one place; there's no preflight in this project, so every block element is
// styled explicitly rather than relying on a base reset. Font size and color
// inherit from the bubble so the same component fits the narrow bubble and the
// wide full-window view.
const MD = [
	'text-[inherit] leading-relaxed break-words',
	// Outer edges hug the bubble padding; inner rhythm is compact.
	'[&>:first-child]:mt-0 [&>:last-child]:mb-0',
	// Paragraphs.
	'[&_p]:my-2',
	// Headings — modest scale, this is a chat reply not a document.
	'[&_h1]:mb-1.5 [&_h1]:mt-3 [&_h1]:text-[1.2em] [&_h1]:font-semibold',
	'[&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-[1.1em] [&_h2]:font-semibold',
	'[&_h3]:mb-1 [&_h3]:mt-2.5 [&_h3]:text-[1.05em] [&_h3]:font-semibold',
	'[&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:font-semibold',
	'[&_h5]:mb-1 [&_h5]:mt-2 [&_h5]:font-semibold',
	'[&_h6]:mb-1 [&_h6]:mt-2 [&_h6]:font-semibold [&_h6]:text-neutral-500',
	// Lists.
	'[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
	'[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
	'[&_li]:my-0.5',
	'[&_li>ul]:my-1 [&_li>ol]:my-1',
	// Inline code.
	'[&_code]:rounded [&_code]:bg-black/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]',
	// Code blocks — own the background so the highlight theme only paints tokens.
	'[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-black/10 [&_pre]:bg-neutral-50 [&_pre]:p-3 [&_pre]:leading-normal',
	'[&_pre_code]:!bg-transparent [&_pre_code]:!p-0 [&_pre_code]:font-mono [&_pre_code]:text-[0.85em]',
	// Blockquote.
	'[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-black/15 [&_blockquote]:pl-3 [&_blockquote]:text-neutral-500',
	// Tables (gfm) — scroll horizontally rather than overflow the bubble.
	'[&_table]:my-2 [&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[0.9em]',
	'[&_th]:border [&_th]:border-black/15 [&_th]:bg-black/[0.03] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
	'[&_td]:border [&_td]:border-black/15 [&_td]:px-2 [&_td]:py-1',
	// Misc inline/blocks.
	'[&_a]:text-blue-600 [&_a]:underline',
	'[&_strong]:font-semibold',
	'[&_hr]:my-3 [&_hr]:border-black/10',
	'[&_img]:max-w-full [&_img]:rounded',
	// Display math can be wide; let it scroll within its own line.
	'[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1',
].join(' ');

export default function MarkdownRenderer({ text }: { text: string }) {
	const onCitation = useContext(CitationContext);
	const source = useMemo(() => (onCitation ? linkifyCitations(text) : text), [text, onCitation]);
	const components = useMemo<Components | undefined>(
		() => (onCitation ? { a: makeAnchor(onCitation) } : undefined),
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
