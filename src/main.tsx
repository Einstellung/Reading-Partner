import React from "react";
import ReactDOM from "react-dom/client";
import { installFetchBridge } from "./ai/fetch-bridge";
import { applyStoredAutostart } from "./platform/app/autostart";
import { initDeviceSettings } from "./platform/app/device";
import { detectShell } from "./platform/app/shell";
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

// Smoke build (VITE_SMOKE, set only by the iOS simulator smoke workflow and by
// the device dictation check): run an unattended check instead of mounting the
// app. Guarded by the env flag so a normal build never loads either chunk.
//
// "1" is the engine check, which the simulator can answer. "dictation" is the
// voice plugin, which it cannot: SpeechTranscriber.isAvailable is false without
// a Neural Engine, and a hold is a finger on a screen, so that one only means
// anything on a real phone driven by src/smoke/dictation.ts.
if (import.meta.env.VITE_SMOKE === "1") {
  void import("./smoke/smoke").then(({ runSmoke }) => runSmoke());
} else if (import.meta.env.VITE_SMOKE === "dictation") {
  void import("./smoke/dictation").then(({ runDictationSmoke }) => runDictationSmoke());
} else if (import.meta.env.VITE_SMOKE === "dictation-guided") {
  // The half of the dictation measurements that needs a person in front of the
  // phone: a level curve and a flush latency are both about a human voice, and
  // a loudspeaker is not one.
  void import("./smoke/dictation-guided").then(({ runGuidedDictation }) => runGuidedDictation());
} else {
  // The bridge must be in place before pi-ai (imported via App) initializes, in
  // case the underlying SDK captures a reference to the global fetch at module
  // load. Hence the dynamic import.
  installFetchBridge();

  // This machine's own file (docs/36), read before anything asks what the
  // machine is for. Then make the login sequence agree with what it asked for —
  // here rather than in a shell, because both shells run on a desktop and the
  // registration is the machine's, not the window's. A no-op on mobile.
  void initDeviceSettings()
    .catch(() => {})
    .then(() => applyStoredAutostart());

  // Which shell (docs/22), decided once here: the phone one carries no reader,
  // so the choice also decides whether PDFium is ever loaded. Both are dynamic
  // imports, so the shell that lost is not in the mounted chunk either.
  const shell = detectShell(window);
  void (shell === "phone"
    ? import("./PhoneApp").then((m) => m.default)
    : import("./App").then((m) => m.default)
  ).then((Shell) => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <Shell />
      </React.StrictMode>,
    );
  });
}
