// Injected once the page has settled. Returns one JSON string (the completion
// value of the script is the only thing webkit_web_view_run_javascript hands
// back), holding the whole document rather than an article inside it: what the
// page is worth is the caller's question, not this module's.
(() => {
  try {
    const root = document.documentElement;
    return JSON.stringify({
      url: location.href,
      title: (document && document.title) || "",
      html: root ? root.outerHTML : "",
    });
  } catch (err) {
    return JSON.stringify({
      url: location.href,
      title: "",
      html: "",
      error: err && err.message ? String(err.message) : String(err),
    });
  }
})();
