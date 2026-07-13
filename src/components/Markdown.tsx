// Public Markdown entry for AI messages. Renders raw text as a plain-text
// fallback, then swaps in the real renderer once its chunk loads.
//
// The renderer pulls in react-markdown, KaTeX, and highlight.js — a large
// payload we don't want in the main bundle. React.lazy code-splits it into an
// async chunk that loads the first time an AI message renders. Until it
// resolves, the Suspense fallback shows the untouched text (a graceful
// degradation, not a loading skeleton); the swap is a single flip once the
// chunk is cached.

import { lazy, memo, Suspense } from 'react';

const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

export const Markdown = memo(function Markdown({ text }: { text: string }) {
	return (
		<Suspense fallback={<span className="whitespace-pre-wrap">{text}</span>}>
			<MarkdownRenderer text={text} />
		</Suspense>
	);
});
