// Wrapper around the caller's script. `__RP_SCRIPT__` is replaced on the Rust
// side with an expression or an IIFE; its value is serialised here, in the
// page, because the bridge back only carries strings.
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
