// Public Markdown entry for AI messages. Renders raw text as a plain-text
// fallback, then swaps in the real renderer once its chunk loads.
//
// The renderer pulls in react-markdown, KaTeX, and highlight.js — a large
// payload we don't want in the main bundle. React.lazy code-splits it into an
// async chunk that loads the first time an AI message renders. Until it
// resolves, the Suspense fallback shows the untouched text (a graceful
// degradation, not a loading skeleton); the swap is a single flip once the
// chunk is cached.
//
// Citation anchors: [p.12] / [paper-slug p.3] in the text become clickable
// links when an onCitation handler is provided (classroom mode, docs/09). The
// handler flows through React context rather than a prop on every message row
// so MessageBubble's memoization is undisturbed.

import { createContext, lazy, memo, Suspense } from 'react';
import type { Citation } from '../../prep/anchors';
import type { Figure } from '../../figures/types';

export type CitationHandler = (citation: Citation) => void;

// Null = citation shorthands stay plain text.
export const CitationContext = createContext<CitationHandler | null>(null);

// Host services for inline [fig:N] cards (M9): resolve a figure by id, rasterize
// its crop lazily, and jump the reader to it. Null = figures render as plain
// text chips (the fallback when no book is open or figures aren't extracted).
// A rendered card crop: its data URL plus natural pixel size, so the card can
// cap its display width to the crop's true resolution (no upscaling / stretch).
export interface RenderedCard {
	src: string;
	width: number;
	height: number;
}

export interface FigureHost {
	getFigure(id: string): Figure | null;
	renderCard(figure: Figure): Promise<RenderedCard | null>;
	onJump(figure: Figure): void;
}

export const FigureContext = createContext<FigureHost | null>(null);

const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

export const Markdown = memo(function Markdown({ text }: { text: string }) {
	return (
		<Suspense fallback={<span className="whitespace-pre-wrap">{text}</span>}>
			<MarkdownRenderer text={text} />
		</Suspense>
	);
});
