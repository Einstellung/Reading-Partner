// A thin wrapper over the Tauri http plugin's fetch that normalizes aborts.
//
// The plugin reports an aborted request by throwing Error("Request cancelled").
// Separately, its cleanup is fire-and-forget: on the signal's "abort" event it
// invokes plugin:http|fetch_cancel and plugin:http|fetch_cancel_body without
// awaiting them (node_modules/@tauri-apps/plugin-http/dist-js/index.js:113,
// :151-154, :131, :159). Once Rust has already dropped the resource those
// invokes reject with "The resource id N is invalid" and there is no JS promise
// attached to catch them — see docs/pitfall/26 and the window-level net in
// src/main.tsx.
//
// Those internal rejections are unreachable from here. What this wrapper CAN do
// is make the caller-facing rejection a standard AbortError, so every abort path
// (watchdog, stop button, hangup, unmount) looks the same to callers whether the
// plugin threw "Request cancelled" or surfaced a resource-id error, matching what
// native fetch does on abort.

import { fetch as tauriFetch, type ClientOptions } from "@tauri-apps/plugin-http";

const RESOURCE_ID_INVALID = /resource id \d+ is invalid/i;

// True for the two strings the plugin uses to report an aborted/dropped request.
export function isPluginAbortError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg === "Request cancelled" || RESOURCE_ID_INVALID.test(msg);
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export type TauriFetch = (
  input: URL | Request | string,
  init?: RequestInit & ClientOptions,
) => Promise<Response>;

// The `underlying` argument is injectable for tests; production always uses the
// real plugin fetch.
export async function cleanTauriFetch(
  input: URL | Request | string,
  init?: RequestInit & ClientOptions,
  underlying: TauriFetch = tauriFetch,
): Promise<Response> {
  try {
    return await underlying(input, init);
  } catch (e) {
    if (init?.signal?.aborted || isPluginAbortError(e)) throw abortError();
    throw e;
  }
}
