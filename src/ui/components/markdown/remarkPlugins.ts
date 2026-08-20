// The remark set for model replies, shared by MarkdownRenderer and its tests.
// Its own module rather than an export on the renderer: the renderer is the
// React.lazy boundary (Markdown.tsx), so a named export there is an invitation
// to a static import that would fold KaTeX and highlight.js back into the main
// bundle.
//
// The cjk-friendly pair is what makes `**结论：**这样不行` bold. CommonMark closes
// a `**` run only when it is right-flanking, and a run preceded by punctuation
// needs whitespace or punctuation after it too — a full-width colon is
// punctuation, the ideograph after it is a letter, so the run never closes and
// the whole thing stays literal text (docs/pitfall/153). The plugins widen the
// flanking rules for CJK; the strikethrough one patches gfm's `~~`, so it has
// to run after remarkGfm, and both come from /parseOnly because nothing here
// serializes back to markdown.

import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';

// Module-level constant so the array isn't recreated on each render.
export const remarkPlugins = [
	remarkGfm,
	remarkMath,
	remarkCjkFriendly,
	remarkCjkFriendlyGfmStrikethrough,
];
