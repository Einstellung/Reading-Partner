# foliate-js (vendored, in part)

Source: https://github.com/johnfactotum/foliate-js
Commit: 78914aef4466eb960965702401634c2cb348e9b1 (2026-05-01)
Copied: 2026-09-09
License: MIT (LICENSE, verbatim)

The author publishes no package; `foliate-js` on npm is someone else's upload.
The files here are byte-for-byte from that commit — keep it that way so a later
commit can be diffed in.

| file | why |
|---|---|
| `epubcfi.js` | CFI parse, compare, and resolve — the reference the app's own CFI code is tested against (`tests/reading/epub/render-cfi.test.ts`) |
| `search.js` | `searchMatcher`, uses `Intl.Segmenter` |
| `text-walker.js` | text-node walker shared by search |

The renderer (`view.js`, `paginator.js`, `epub.js`, `overlayer.js`,
`progress.js`, `fixed-layout.js`) and the stubs that kept it importable were
removed when the EPUB reading area moved to fixed pages in shadow-DOM cards
(docs/64). Nothing under `src/` imports this directory at runtime.
