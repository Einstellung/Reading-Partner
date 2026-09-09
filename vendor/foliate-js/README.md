# foliate-js (vendored)

Source: https://github.com/johnfactotum/foliate-js
Commit: 78914aef4466eb960965702401634c2cb348e9b1 (2026-05-01)
Copied: 2026-09-09
License: MIT (LICENSE, verbatim)

The author publishes no package; `foliate-js` on npm is someone else's upload.
The files here are byte-for-byte from that commit except where a `PATCHED:`
comment says otherwise — keep it that way so a later commit can be diffed in.

Files, and why each one is here:

| file | why |
|---|---|
| `view.js` | `<foliate-view>`, the element the app talks to |
| `paginator.js` | `<foliate-paginator>`, CSS multi-column pagination and the content iframe |
| `epub.js` | EPUB container/OPF/spine parsing on top of a zip loader we supply |
| `epubcfi.js` | CFI parse, compare, and resolve; filters injected nodes |
| `overlayer.js` | SVG overlay for highlights, with `hitTest` |
| `search.js` | `searchMatcher`, uses `Intl.Segmenter` |
| `progress.js` | TOC and section progress, imported by `view.js` |
| `text-walker.js` | text-node walker shared by search and overlay |
| `fixed-layout.js` | `<foliate-fxl>`, the pre-paginated branch `view.js` imports |

Not copied: `opds.js`, `dict.js`, `footnotes.js`, `quote-image.js`,
`uri-template.js`, `reader.js`, `reader.html`, `ui/`, and the real
`vendor/zip.js` / `vendor/fflate.js`. They are other formats, other apps, or the
demo reader.

Stubbed, not copied: `mobi.js`, `fb2.js`, `comic-book.js`, `pdf.js`, `tts.js`,
`vendor/zip.js`, `vendor/fflate.js`. `view.js` reaches for all seven from
`makeBook()` and `initTTS()`, branches this app never takes — but Vite resolves a
dynamic import with a literal specifier at transform time and fails the whole
module when the file is missing, unreachable branch or not
(`docs/pitfall/243-...`). So each one exists as a few lines that throw. See
`./unsupported.js`.

Patches applied (grep `PATCHED:`):

- `paginator.js` — the content iframe's `sandbox` no longer carries
  `allow-scripts`. Upstream ships `allow-same-origin allow-scripts`; a book's
  inline script would then run with the app's own privileges.

- `paginator.js` — the paginator's own touch listeners are not registered. The
  book's iframe takes no pointers, so the pane above it is the one reading of a
  swipe; upstream's listeners turned a second and a third page
  (`docs/pitfall/260`).

- `paginator.js` — `View.render()` and `View.expand()` return when the iframe
  has no document yet. The container's ResizeObserver calls render() before the
  first section has loaded, and upstream reads `this.document.documentElement`
  straight away (`docs/pitfall/265`).
