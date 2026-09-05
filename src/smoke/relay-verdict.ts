// Whether the speech probe's live leg worked, read off the relay's own record
// (speech-probe.ts, plugins/voice/src/live.rs).
//
// Every other leg of that probe is judged by the player: it hands the player
// PCM synthesised days ago, the only question is whether the phone spoke it,
// and the webview hears the answer as `speaking:0`. The live leg is not that
// leg. It is started from Rust and what it adds is everything in front of the
// player — the request, the first audio back, the trim, the relay's admission
// gate — whose only record is the timeline the relay answers with.
//
// Judging it by `speaking:0` cost a device run (2026-09-05): every sentence
// failed at the vendor, so nothing was ever handed to the player, no player
// event was ever coming, and the leg sat out its whole 180 s timeout to record
// `ok:false` with no reason on it.

/// As much of what `plugin:voice|speech_live` answers with as the verdict
/// reads. Untyped on the Rust side on purpose — it is a diagnostic whose shape
/// follows the question being asked — so nothing here may assume a field is
/// there.
export type RelayRow = { event?: string; id?: number; error?: string };

export type RelaySummary = {
  sentences?: number;
  timeline?: RelayRow[];
};

export type LegVerdict = { ok: boolean; error: string | null };

/// The live leg counts when every sentence made it the whole way: the vendor
/// sent audio back for each one (`firstAudio`), each one reached the player
/// (`queued`), none was given up on (`failed`), and the loop ended by running
/// out of sentences (`drained`) rather than by the player refusing the turn
/// (`abandoned`).
///
/// The checks are ordered so that the first thing to go wrong is the thing
/// reported: a sentence that failed explains every count behind it.
export function judgeRelayLeg(relay: unknown): LegVerdict {
  if (!relay || typeof relay !== "object") {
    return { ok: false, error: "the live leg got no record back from the relay" };
  }
  const summary = relay as RelaySummary;
  const rows = Array.isArray(summary.timeline) ? summary.timeline : [];
  const of = (event: string) => rows.filter((row) => row?.event === event);
  const sentences = typeof summary.sentences === "number" ? summary.sentences : 0;
  if (sentences === 0) {
    return { ok: false, error: "the live leg was given nothing to say" };
  }

  const failed = of("failed");
  if (failed.length > 0) {
    // The first one whole, rather than a count: twelve failures are usually one
    // failure twelve times, and that string is the only place its cause is
    // written down.
    const why = failed[0].error ?? "no reason recorded";
    return { ok: false, error: `${failed.length} of ${sentences} sentences failed: ${why}` };
  }
  const answered = new Set(of("firstAudio").map((row) => row.id));
  if (answered.size < sentences) {
    return {
      ok: false,
      error: `${answered.size} of ${sentences} sentences ever sent audio back`,
    };
  }
  const queued = new Set(of("queued").map((row) => row.id));
  if (queued.size < sentences) {
    return {
      ok: false,
      error: `${queued.size} of ${sentences} sentences reached the player`,
    };
  }
  if (of("abandoned").length > 0) {
    return { ok: false, error: "the player refused the turn and the relay wound it up" };
  }
  if (of("drained").length === 0) {
    return { ok: false, error: "the relay stopped without saying it had drained" };
  }
  return { ok: true, error: null };
}
