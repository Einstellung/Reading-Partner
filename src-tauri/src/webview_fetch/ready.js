// Asked of a document that has not reported a load event, to find out whether
// it has one worth reading anyway. Kept apart from extract.js and far smaller:
// this runs on a page that is still loading, several times a page, and all the
// rule behind it needs is how far the parser got and how much text is rendered
// (policy.rs, `has_begun`).
(() => {
  try {
    const body = document.body;
    return JSON.stringify({
      state: document.readyState || "loading",
      chars: body && body.innerText ? body.innerText.length : 0,
    });
  } catch (err) {
    // A document too early to have a body is not begun; say so rather than
    // failing the wait.
    return JSON.stringify({ state: "loading", chars: 0 });
  }
})();
