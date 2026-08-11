// One vocabulary for "this was cancelled" across the app. Native fetch rejects
// an aborted request with DOMException("AbortError"), the Tauri http wrapper
// normalizes its own strings to the same thing (tauri-fetch.ts), and code that
// aborts before it ever reaches the network needs to throw something that reads
// the same to its caller. AbortError is that something, and isAbortError tells
// a cancellation apart from a real failure — the difference between parking a
// run and recording a source as broken.

export class AbortError extends Error {
  constructor(message = "The operation was aborted.") {
    super(message);
    this.name = "AbortError";
  }
}

// True for our AbortError, for DOMException("AbortError") from fetch, and for
// anything else that follows the same naming.
export function isAbortError(e: unknown): boolean {
  return e instanceof AbortError || (e instanceof Error && e.name === "AbortError");
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}
