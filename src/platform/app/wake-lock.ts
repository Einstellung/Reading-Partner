// Keep the screen on for the length of a long unattended run (docs/22: the phone
// generates its briefing while the reader waits and watches). A phone that dims
// and sleeps mid-run gets its webview suspended, which is the interruption the
// briefing checkpoint exists to survive — this is the cheaper half of the fix,
// which is to not be interrupted in the first place.
//
// What is actually known about the Screen Wake Lock API here, since this ships
// inside a WKWebView and not a browser tab:
//
//   - WebKit implemented it in April 2023 and it shipped with Safari on iOS and
//     iPadOS 16.4. Below that, navigator.wakeLock is simply absent.
//   - Home Screen Web Apps had it broken until iOS/iPadOS 18.4 (WebKit bug
//     254545): they run as ViewServices rather than a full UIApplication, and
//     the implementation goes through UIApplication.idleTimerDisabled. A Tauri
//     app is a full UIApplication, so that root cause does not apply to us —
//     but this is an inference from the bug's diagnosis, NOT VERIFIED on a
//     device or in the simulator. Treat the lock as best effort.
//   - Safari is reported to want a user gesture for the request. Generate is a
//     tap, so the first acquire rides that activation; the startup resume has no
//     gesture at all and may simply be refused.
//   - By spec the lock is released whenever the document becomes hidden, and it
//     is not restored on its own. Hence the visibilitychange re-acquire below,
//     which is the canonical usage, not a workaround for anything iOS-specific.
//
// Every failure is swallowed. Nothing here is allowed to cost the caller a run:
// a screen that sleeps is a worse experience, not a broken one.

export interface WakeLockSentinelLike {
  released?: boolean;
  release(): Promise<void>;
}

export interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

// The slice of the browser this needs, narrowed so tests can hand it a fake and
// so the module compiles regardless of which lib.dom version defines WakeLock.
export interface WakeLockTarget {
  navigator: { wakeLock?: WakeLockLike };
  document: {
    hidden: boolean;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
  };
}

export interface ScreenWakeLock {
  // Ask for (true) or give up (false) the lock. Idempotent, synchronous to the
  // caller: the request is fired and forgotten.
  set(on: boolean): void;
}

export function browserWakeLockTarget(): WakeLockTarget | null {
  const g = globalThis as unknown as Partial<WakeLockTarget>;
  if (!g.navigator || !g.document) return null;
  return g as WakeLockTarget;
}

// A lock that survives the page being hidden and shown again: while it is wanted
// it re-acquires on every return to visible, because the platform drops it on
// the way out.
export function createScreenWakeLock(target: WakeLockTarget | null): ScreenWakeLock {
  if (!target || !target.navigator.wakeLock) {
    // Below iOS 16.4, or a webview that does not expose it: a no-op, so callers
    // need no capability check of their own.
    return { set: () => {} };
  }
  const wakeLock = target.navigator.wakeLock;
  let wanted = false;
  let sentinel: WakeLockSentinelLike | null = null;
  // Guards the gap between asking and being answered: without it a hide/show
  // burst can leave two sentinels alive with only one of them tracked.
  let pending = false;

  const acquire = (): void => {
    if (!wanted || pending || target.document.hidden) return;
    if (sentinel && !sentinel.released) return;
    pending = true;
    wakeLock
      .request("screen")
      .then((s) => {
        pending = false;
        // The run may have finished while the request was in flight.
        if (!wanted) {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
      })
      .catch(() => {
        // Refused (no user gesture), unsupported, or the page went away.
        pending = false;
      });
  };

  const onVisibility = (): void => {
    if (target.document.hidden) {
      // The platform released it on the way out and will not hand it back; the
      // sentinel we are holding is spent.
      sentinel = null;
      return;
    }
    acquire();
  };

  return {
    set(on: boolean): void {
      if (on === wanted) return;
      wanted = on;
      if (on) {
        target.document.addEventListener("visibilitychange", onVisibility);
        acquire();
        return;
      }
      target.document.removeEventListener("visibilitychange", onVisibility);
      const held = sentinel;
      sentinel = null;
      if (held) void held.release().catch(() => {});
    },
  };
}
