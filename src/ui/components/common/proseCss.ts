// The prose look for injected article HTML, shared by the briefing's article
// view and the saved-article reader. The body is third-party HTML injected with
// dangerouslySetInnerHTML, so no utility class reaches it and a scoped <style>
// has to establish the whole typography. Preflight has already stripped the
// browser defaults (margins, list markers, heading scale, table borders), so
// every tag the sanitizer can let through is restored here rather than left to
// the UA. The <style> element is unlayered, so it outranks preflight's `base`
// layer without any !important.
//
// The tag list follows sanitize.ts: it drops script/style/iframe/object/embed/
// video/audio/canvas/svg/form and the interactive controls, and passes
// everything else through, so anything a news page can put in running text can
// arrive here.

export const ARTICLE_PROSE_CLASS = "info-article-body";

export const ARTICLE_PROSE_CSS = `
.info-article-body { color: #222; font-size: 17px; line-height: 1.75; }

.info-article-body p { margin: 0 0 1.1em; }
.info-article-body h1, .info-article-body h2, .info-article-body h3,
.info-article-body h4, .info-article-body h5, .info-article-body h6 { line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 600; color: #111; }
.info-article-body h1 { font-size: 1.5em; }
.info-article-body h2 { font-size: 1.3em; }
.info-article-body h3 { font-size: 1.12em; }
.info-article-body h4 { font-size: 1em; }
.info-article-body h5, .info-article-body h6 { font-size: 0.92em; }
.info-article-body hr { margin: 2em 0; border-top: 1px solid #e6e6e6; }

.info-article-body ul, .info-article-body ol { margin: 0 0 1.1em; padding-left: 1.4em; }
.info-article-body ul { list-style: disc; }
.info-article-body ul ul { list-style: circle; }
.info-article-body ul ul ul { list-style: square; }
.info-article-body ol { list-style: decimal; }
.info-article-body li { margin: 0.3em 0; }
.info-article-body li > ul, .info-article-body li > ol { margin: 0.3em 0; }
.info-article-body dl { margin: 0 0 1.1em; }
.info-article-body dt { margin-top: 0.8em; font-weight: 600; }
.info-article-body dd { margin: 0.2em 0 0 1.4em; }

.info-article-body blockquote { margin: 1.1em 0; padding-left: 1em; border-left: 3px solid #e0dcf3; color: #555; }
.info-article-body pre { margin: 1.1em 0; overflow-x: auto; background: #f6f6f8; padding: 0.9em; border-radius: 8px; font-size: 0.9em; line-height: 1.6; }
.info-article-body code, .info-article-body kbd, .info-article-body samp, .info-article-body tt { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
.info-article-body pre code { font-size: 1em; }

.info-article-body table { margin: 1.2em 0; display: block; overflow-x: auto; border-collapse: collapse; }
.info-article-body td, .info-article-body th { border: 1px solid #e6e6e6; padding: 0.4em 0.7em; }
.info-article-body caption { margin-bottom: 0.5em; }

.info-article-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; display: block; }
.info-article-body figure { margin: 1.2em 0; }
.info-article-body figcaption { font-size: 0.85em; color: #888; text-align: center; margin-top: 0.5em; }
.info-article-body a { color: #6d5ae0; text-decoration: underline; text-underline-offset: 2px; }
`;

// Hide an image that failed to load: the img: proxy refused the host, the
// upstream fetch died, the bytes were not an image, or the article is being
// read outside Tauri where the external URL is blocked outright. There is no
// CSS for "failed to load" and the sanitizer must not gain an onerror
// attribute, so the two article views bind one capture-phase error handler
// (error does not bubble, but it does capture) and this decides. Duck-typed
// rather than instanceof HTMLImageElement so it is callable without a DOM.
export function hideBrokenImage(target: EventTarget | null): void {
  const el = target as { tagName?: string; style?: { display: string } } | null;
  if (el?.tagName === "IMG" && el.style) el.style.display = "none";
}
