import React from "react";
import ReactDOM from "react-dom/client";
import { installFetchBridge } from "./ai/fetch-bridge";
import { applyStoredAutostart } from "./platform/app/autostart";
import { initDeviceSettings } from "./platform/app/device";
import { detectShell } from "./platform/app/shell";
import { initPaperTint } from "./ui/components/base/paper-tint";
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
} else if (import.meta.env.VITE_SMOKE === "dictation-long") {
  // The rehearsal feature's gate: twenty minutes of continuous recognition,
  // which is four times the dictation backstop and a span nothing has run for.
  void import("./smoke/dictation-long").then(({ runLongDictation }) => runLongDictation());
} else if (import.meta.env.VITE_SMOKE === "dictation-bench") {
  // The interactive one: the real composer with nothing above it, so the bar
  // can be tried by hand on a .dev build that cannot sign in (docs/pitfall/31).
  void import("./smoke/dictation-bench").then(({ runDictationBench }) => runDictationBench());
} else if (import.meta.env.VITE_SMOKE === "speech") {
  // The playback experiments: six legs over a fixture already on the device, no
  // network and nobody in the room (docs/33, M-voice-2).
  void import("./smoke/speech-probe").then(({ runSpeechProbe }) => runSpeechProbe());
} else if (import.meta.env.VITE_SMOKE === "speech-live") {
  // The same legs plus the one with the vendor in it: text synthesised now,
  // trimmed and scheduled in Rust, spoken by the phone. Needs MIMO_API_KEY in
  // the app's environment.
  void import("./smoke/speech-probe").then(({ runSpeechProbe }) =>
    runSpeechProbe({ live: true }),
  );
} else if (import.meta.env.VITE_SMOKE === "speech-echo") {
  // The truth-table run: one sentence with voice processing on and nothing torn
  // down, then the same thing after a teardown, then the leg that aborts. Under
  // a minute instead of thirteen.
  void import("./smoke/speech-probe").then(({ runSpeechProbe }) =>
    runSpeechProbe({ echoOnly: true }),
  );
} else if (import.meta.env.VITE_SMOKE === "speech-control") {
  // The echo experiment's positive control: the leg that hears nothing of its
  // own playback, then the same measurement with a person reading the same
  // sentence instead, then both at once. Needs somebody in front of the phone
  // for about a minute; the screen says when to read.
  void import("./smoke/speech-probe").then(({ runSpeechProbe }) =>
    runSpeechProbe({ control: true }),
  );
} else if (import.meta.env.VITE_SMOKE === "turn") {
  // The three full-duplex questions, in one pass with a person in front of the
  // phone for five four-second readings (docs/33, M-voice-3). Whether
  // SpeechDetector reports anything, what a forced finalize costs, and what
  // this build's tap and this placement's levels look like.
  void import("./smoke/turn-probe").then(({ runTurnProbe }) => runTurnProbe());
} else if (import.meta.env.VITE_SMOKE === "speech-bench") {
  // The half of it that needs ears: whether twelve scheduled buffers sound like
  // one stretch of speech.
  void import("./smoke/speech-bench").then(({ runSpeechBench }) => runSpeechBench());
} else if (import.meta.env.VITE_SMOKE === "dictation-guided") {
  // The half of the dictation measurements that needs a person in front of the
  // phone: a level curve and a flush latency are both about a human voice, and
  // a loudspeaker is not one.
  void import("./smoke/dictation-guided").then(({ runGuidedDictation }) => runGuidedDictation());
} else {
  // The palette, before anything is drawn in it. Synchronous and first: both
  // shells are dynamic imports, so there are frames between this line and the
  // first component, and every one of them would be white if the tint waited
  // for React. Not in the smoke branch above — that page is a diagnostic
  // readout, not the app, and it is looked at by a workflow rather than a
  // person.
  initPaperTint(window);

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
