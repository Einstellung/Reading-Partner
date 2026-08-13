// Mounting a whole shell in a test starts everything the app starts on the way
// up, and none of it is what a shell test is about: the settings and device
// files go through Tauri's invoke, which is not there, and the reader engine
// fetches /pdfium/pdfium.wasm off the page origin, which in a test is whatever
// happens to be listening on localhost:80.
//
// So the two edges are closed for the duration of a mount: fetch refuses, and
// the console lines every one of those failures writes are dropped. Restore by
// calling what this returns — in an afterEach, before the window comes down.
export function hushShell(): () => void {
  const fetchWas = globalThis.fetch;
  const errorWas = console.error;
  const warnWas = console.warn;
  // The cast is React's doing: its DOM types hang preconnect and prefetchDNS off
  // fetch, and nothing here calls either.
  globalThis.fetch = (() =>
    Promise.reject(new Error("a test made a network call"))) as unknown as typeof fetch;
  console.error = () => {};
  console.warn = () => {};
  return () => {
    globalThis.fetch = fetchWas;
    console.error = errorWas;
    console.warn = warnWas;
  };
}
