// Wrapper around the caller's script. The placeholder below is replaced on the
// Rust side with an expression or an IIFE; its value is serialised here, in the
// page, because the bridge back only carries strings.
//
// The placeholder's name is not written anywhere else in this file, comments
// included: the substitution is a plain string replace over the whole template,
// so a second mention would take a copy of the caller's script as well — and a
// script of more than one line would then spill its second line out of the
// comment and into the page (docs/pitfall/383).
//
// A script that throws is not a failed fetch: the page loaded, its markup is
// already captured, and the only thing missing is what the script wanted to
// read. So both outcomes come back as JSON and the Rust side decides.
(() => {
  try {
    const value = (__RP_SCRIPT__);
    const json = JSON.stringify({ ok: true, value: value === undefined ? null : value });
    // JSON.stringify answers undefined for a function or a symbol.
    return typeof json === "string"
      ? json
      : JSON.stringify({ ok: false, error: "the script's value is not JSON-serialisable" });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err && err.message ? String(err.message) : String(err),
    });
  }
})();
