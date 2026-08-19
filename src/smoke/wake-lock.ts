// Keeping the phone awake for the length of a dictation run, shared by every
// entry under smoke/ because all four of them are minutes long and the device
// auto-locks after two.
//
// Two things the iOS webview does that the spec does not lead you to expect:
// the request is refused with "Permission was denied" until something on the
// page has been touched (docs/pitfall/141), so it has to be asked for after a
// real tap rather than at boot; and the lock is dropped when the page is
// backgrounded and is not restored on the way back, hence the visibilitychange
// re-request.
//
// The return value is a sentence for the run's JSON and its console line, not a
// status code. Nothing branches on it — a refused lock is a run that may be cut
// short, not a run that should not start.

export async function holdTheScreen(): Promise<string> {
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: "screen"): Promise<unknown> };
  };
  if (!nav.wakeLock) return "no wakeLock API";
  try {
    await nav.wakeLock.request("screen");
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void nav.wakeLock?.request("screen");
    });
    return "held";
  } catch (e) {
    return `refused: ${String((e as Error)?.message ?? e)}`;
  }
}
