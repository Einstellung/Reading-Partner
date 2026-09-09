// Not upstream. Stand-ins for the foliate-js modules this repo does not vendor.
//
// `view.js` reaches for seven of them — comic-book, fb2, pdf, mobi, tts and the
// two files under vendor/ — from `makeBook()` and `initTTS()`, branches we never
// take: the book object is built here (src/reading/epub) and the reading voice
// is the app's own. Leaving the files out is not an option, because Vite's
// import analysis resolves a dynamic import with a literal specifier at
// transform time and fails the whole module when it cannot, however unreachable
// the branch is (docs/pitfall/243). So the files exist and throw.
//
// Keeping them as stubs rather than deleting the branches from view.js is what
// keeps view.js byte-identical to upstream, so the next version can be diffed in.

export function unsupported(what) {
  throw new Error(
    `foliate-js: ${what} is not vendored in this app. ` +
      `Only the EPUB path is (vendor/foliate-js/README.md).`,
  );
}
