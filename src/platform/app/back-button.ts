// The Android system back button, routed to the app's own back action.
//
// Tauri's Android AppPlugin installs an OnBackPressedCallback that is always
// enabled, and branches on whether anything is listening: with no listener it
// goes back in the webview or finishes the activity, with a listener it only
// emits the event and does nothing else. So a listener is not a hook on the
// button, it is ownership of it — while one is registered the button can no
// longer leave the app, and there is no JS-reachable way to ask it to (the
// plugin's `exit` command carries no ACL permission in tauri 2.11.5, so the
// invoke is rejected before it reaches Kotlin).
//
// Hence the shape below: the caller binds only while it has somewhere to go
// back to, and unbinds at the bottom of its stack, where the system has to be
// free to background the app.
//
// Not Android — desktop, iOS, a plain browser — rejects the registration
// (`register_listener` is not a command there). That is the intended no-op:
// nothing else in the app reacts to a back button on those platforms.

import { onBackButtonPress } from "@tauri-apps/api/app";
import type { PluginListener } from "@tauri-apps/api/core";

export function bindSystemBack(handler: () => void): () => void {
  let bound = true;
  let listener: PluginListener | null = null;

  onBackButtonPress(() => {
    if (bound) handler();
  })
    .then((l) => {
      listener = l;
      // Unbound while the registration was still in flight.
      if (!bound) void l.unregister().catch(() => {});
    })
    .catch(() => {
      // No Android back button here.
    });

  return () => {
    bound = false;
    void listener?.unregister().catch(() => {});
    listener = null;
  };
}
