// A rehearsal opened from the topic's Rehearsal section (docs/44, "入口"): the
// talk read off disk and put on screen, to be read or to be given.
//
// It replaces the topic's sections the way a retell does, rather than covering
// them: the section it was opened from sits inside a scrolling column, and a
// full-screen cover mounted there would be clipped by it.

import type { Rehearsal } from "../../../reading/rehearsal";
import RehearsalView from "./RehearsalView";
import { openTranscriptSource } from "./start";
import { useTalkOutline } from "./useRehearsal";

export default function RehearsalScreen(props: {
  rehearsal: Rehearsal;
  // `gave` is false when the talk was opened to read and nothing was given.
  onBack(gave: boolean): void;
  onSaved(recorded: boolean): void;
}) {
  const { outline, error } = useTalkOutline(props.rehearsal.outlineId);

  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d0f14]">
        <p className="m-0 text-sm text-white/70">{error}</p>
        <button
          type="button"
          className="text-sm text-white/50 underline"
          onClick={() => props.onBack(false)}
        >
          Back to the topic
        </button>
      </div>
    );
  }

  if (!outline) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#0d0f14]">
        <p className="m-0 text-sm text-white/70">Opening the note…</p>
      </div>
    );
  }

  return (
    <RehearsalView
      rehearsal={props.rehearsal}
      outline={outline}
      backLabel="Back to the topic"
      // Which talk is being given is known before a word of it is said, so its
      // name goes in as the recognizer's hot words. Opened when the reader
      // starts, not here: a talk is opened to read as often as to give.
      openSource={() => openTranscriptSource({ title: props.rehearsal.name })}
      onExit={props.onBack}
      onSaved={props.onSaved}
    />
  );
}
