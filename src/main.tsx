import React from "react";
import ReactDOM from "react-dom/client";
import { installFetchBridge } from "./ai/fetch-bridge";
import "./styles.css";

// Dev-only: silence the Tauri http plugin's fire-and-forget cleanup rejections.
// When a request is aborted (watchdog, stop button, hangup, unmount) the plugin
// fires plugin:http|fetch_cancel / fetch_cancel_body without awaiting them (see
// docs/pitfall/26); once Rust has already dropped the resource those invokes
// reject with "The resource id N is invalid", and no JS promise is attached to
// catch them. Those promises live inside the plugin, so cleanTauriFetch cannot
// reach them — this net is the only place to swallow them. The regex is anchored
// to the plugin's exact wording ("resource id <number> is invalid"), so an
// unrelated app rejection cannot match; every other rejection propagates
// untouched. Compiled out of production builds.
if (import.meta.env.DEV) {
  const RESOURCE_ID_INVALID = /resource id \d+ is invalid/i;
  let logged = false;
  window.addEventListener("unhandledrejection", (event) => {
    const msg =
      event.reason instanceof Error ? event.reason.message : String(event.reason);
    if (!RESOURCE_ID_INVALID.test(msg)) return;
    event.preventDefault();
    if (!logged) {
      logged = true;
      console.debug("[tauri-http] suppressed post-abort resource-id rejection:", msg);
    }
  });
}

// The bridge must be in place before pi-ai (imported via App) initializes, in
// case the underlying SDK captures a reference to the global fetch at module
// load. Hence the dynamic import.
installFetchBridge();

void import("./App").then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
