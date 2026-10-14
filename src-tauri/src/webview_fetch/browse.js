// One look at the page in the browse window (browse.rs): where it is, how far
// it has loaded, whether it is still the document that was marked before the
// last navigation, and the value of the caller's script.
//
// Two placeholders are replaced on the Rust side: the mark first (a JSON string,
// or null when there is none), then the caller's script, last, so nothing in the
// script is ever taken for a placeholder. Neither name is written anywhere else
// in this file, comments included: the substitution is a plain string replace
// over the whole template (docs/pitfall/383).
//
// A script that throws is not a failed look: where the page is still comes back,
// with the error beside it. Only strings cross the bridge, so the whole answer is
// serialised here.
(() => {
  const out = { url: "", title: "", state: "", chars: 0, fresh: true, ok: true, value: null, error: null };
  try {
    out.url = String(location.href);
    out.title = String(document.title || "");
    out.state = String(document.readyState || "");
    const body = document.body;
    out.chars = body && body.innerText ? body.innerText.length : 0;
    out.fresh = window.__rpBrowseMark !== __RP_MARK__;
  } catch (err) {
    // A document too early to have a body still has a location.
  }
  try {
    const value = (__RP_SCRIPT__);
    out.value = value === undefined ? null : value;
  } catch (err) {
    out.ok = false;
    out.error = err && err.message ? String(err.message) : String(err);
  }
  let json;
  try {
    json = JSON.stringify(out);
  } catch (err) {
    json = undefined;
  }
  if (typeof json === "string") return json;
  // JSON.stringify answers undefined for a function or a symbol, and throws on a
  // cycle or a BigInt.
  out.ok = false;
  out.value = null;
  out.error = "the script's value is not JSON-serialisable";
  return JSON.stringify(out);
})();
