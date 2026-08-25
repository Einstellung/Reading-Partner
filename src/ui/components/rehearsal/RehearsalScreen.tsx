// A rehearsal opened from the topic's Rehearsal section (docs/44, "入口"): the
// outline panel full screen, with the talk read and the microphone opened
// before it gets there.
//
// It replaces the topic's sections the way a retell does, rather than covering
// them: the section it was opened from is inside a scrolling column, and a
// full-screen cover mounted there would be clipped by it.

import { useEffect, useState } from "react";
import type { Rehearsal, TranscriptSource } from "../../../reading/rehearsal";
import RehearsalView from "./RehearsalView";
import { openTranscriptSource } from "./start";
import { useTalkOutline } from "./useRehearsal";

export default function RehearsalScreen(props: {
  rehearsal: Rehearsal;
  onBack(): void;
  onSaved(): void;
}) {
  // Made once, before the panel is on screen: capture has to be running by the
  // time the first segment goes up, or every word said to it is lost. null is
  // the ordinary answer on a machine with no STT key and no dictation, and the
  // pass is then segments and no words.
  const [transcript, setTranscript] = useState<TranscriptSource | null>(null);
  const [ready, setReady] = useState(false);
  const { outline, error } = useTalkOutline(props.rehearsal.outlineId);

  useEffect(() => {
    let cancelled = false;
    void openTranscriptSource({ title: props.rehearsal.name }).then((source) => {
      if (cancelled) {
        // Left before it was built. Nothing has been recorded, but the session
        // is open on the host and would stay open.
        void source?.stop().catch(() => {});
        return;
      }
      setTranscript(source);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [props.rehearsal.name]);

  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d0f14]">
        <p className="m-0 text-sm text-white/70">{error}</p>
        <button type="button" className="text-sm text-white/50 underline" onClick={props.onBack}>
          Back to the topic
        </button>
      </div>
    );
  }

  if (!ready || !outline) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#0d0f14]">
        <p className="m-0 text-sm text-white/70">Starting the rehearsal…</p>
      </div>
    );
  }

  return (
    <RehearsalView
      rehearsal={props.rehearsal}
      outline={outline}
      backLabel="Back to the topic"
      transcript={transcript ?? undefined}
      onExit={props.onBack}
      onSaved={props.onSaved}
    />
  );
}
