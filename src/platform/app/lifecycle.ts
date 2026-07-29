// When the app comes to the front and when it goes away, as one signal instead
// of four events. Callers that need to act on either edge — sync is the first —
// get exactly one call per transition.
//
// Why four events and not just `visibilitychange`: measured on WebKitGTK 2.52
// (the webview Tauri uses on Linux), a window that merely loses focus to another
// window stays `visible` and fires nothing but `blur`. Minimising or unmapping
// it does fire `visibilitychange`. So visibility alone misses the most common
// desktop case of leaving and coming back, which is the one the desktop was
// meant to benefit from (docs/pitfall/69). `pagehide` is the event iOS is
// reliable about on the way out, and the app already flushes its debounced
// writes on it (App.tsx, platform/app/annotations.ts, threads.ts).
//
// Both edges are therefore a state, not an event: awake means visible *and*
// focused, and only a change of that state is reported. Minimising fires blur
// and visibilitychange together; the caller hears about it once.

export interface AppLifecycleHandlers {
  // Visible and focused again, after being one or the other.
  onForeground: () => void;
  // Hidden, unfocused, or on its way out of the page.
  onBackground: () => void;
}

export interface LifecycleTarget {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  document: { hidden: boolean };
}

// Binds the listeners and returns the undo. Starts awake: the app is mounting,
// which it does in front of the user, and assuming otherwise would spend a
// foreground call on the first focus event of the session.
export function observeAppLifecycle(
  win: LifecycleTarget,
  handlers: AppLifecycleHandlers,
): () => void {
  let awake = true;
  const set = (next: boolean): void => {
    if (next === awake) return;
    awake = next;
    if (next) handlers.onForeground();
    else handlers.onBackground();
  };

  // Focus is not consulted here: a window can be restored from the taskbar
  // without taking focus, and it is in front of the user either way.
  const visibility = (): void => set(!win.document.hidden);
  // A focus event while the document is hidden is not the app coming back — on
  // WebKitGTK the restore order is focus first, visibilitychange after.
  const focused = (): void => set(!win.document.hidden);
  const away = (): void => set(false);

  win.addEventListener("visibilitychange", visibility);
  win.addEventListener("focus", focused);
  win.addEventListener("blur", away);
  win.addEventListener("pagehide", away);
  return () => {
    win.removeEventListener("visibilitychange", visibility);
    win.removeEventListener("focus", focused);
    win.removeEventListener("blur", away);
    win.removeEventListener("pagehide", away);
  };
}
