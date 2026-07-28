// The prose look for injected article HTML, shared by the briefing's article
// view and the saved-article reader. Preflight is off and the body is injected
// HTML that utilities cannot reach, so a scoped <style> establishes it.

export const ARTICLE_PROSE_CLASS = "info-article-body";

export const ARTICLE_PROSE_CSS = `
.info-article-body { color: #222; font-size: 17px; line-height: 1.75; }
.info-article-body p { margin: 0 0 1.1em; }
.info-article-body h1, .info-article-body h2, .info-article-body h3 { line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 600; color: #111; }
.info-article-body h1 { font-size: 1.5em; }
.info-article-body h2 { font-size: 1.3em; }
.info-article-body h3 { font-size: 1.12em; }
.info-article-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; display: block; }
/* External images are blocked by the webview's CSP/COEP (docs/pitfall/30); the
   host inlines them as data: URLs progressively. Hide any still-external img so
   it shows no broken-image icon until its data: URL swaps in. */
.info-article-body img[src^="http"] { display: none; }
.info-article-body figure { margin: 1.2em 0; }
.info-article-body figcaption { font-size: 0.85em; color: #888; text-align: center; margin-top: 0.5em; }
.info-article-body a { color: #6d5ae0; text-decoration: underline; text-underline-offset: 2px; }
.info-article-body ul, .info-article-body ol { margin: 0 0 1.1em; padding-left: 1.4em; }
.info-article-body li { margin: 0.3em 0; }
.info-article-body blockquote { margin: 1.1em 0; padding-left: 1em; border-left: 3px solid #e0dcf3; color: #555; }
.info-article-body pre { overflow-x: auto; background: #f6f6f8; padding: 0.9em; border-radius: 8px; font-size: 0.9em; }
.info-article-body code { font-family: ui-monospace, monospace; font-size: 0.92em; }
.info-article-body table { display: block; overflow-x: auto; border-collapse: collapse; }
.info-article-body td, .info-article-body th { border: 1px solid #e6e6e6; padding: 0.4em 0.7em; }
`;
