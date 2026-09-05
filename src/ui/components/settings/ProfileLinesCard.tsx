// The one screen that carries the old profile across to statements (docs/48).
//
// user-profile.md and the AI's guesses stop being read at 0.13 and neither file
// is deleted. What is on this card is the reader's chance to say which of those
// lines still holds; a line they tick becomes a statement they own, and a line
// they leave writes nothing at all — "looked at it and did not tick it" is too
// weak a signal to record, and it has no date.
//
// Everything but the drawing is in profile-pick.ts.

import { useEffect, useReducer } from "react";

import { localDate } from "../../../memory/observations/files";
import { createStatement, listStatements } from "../../../memory/live/statements";
import { declaredText, splitProfile } from "../../../memory/profile/guess";
import { loadProfile } from "../../../memory/profile/profile";
import type { StatementKind } from "../../../memory/statements/types";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { CARD } from "./cardStyles";
import {
  checkedWrites,
  groupLines,
  initialProfileLinesState,
  profileLinesReducer,
  writtenNote,
  type ProfileLine,
  type ProfileLinesAction,
  type ProfileLinesState,
} from "./profile-pick";

const KINDS: { value: StatementKind; label: string }[] = [
  { value: "profile", label: "About me" },
  { value: "concern", label: "Watching" },
];

export default function ProfileLinesCard() {
  const [state, dispatch] = useReducer(profileLinesReducer, initialProfileLinesState);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [text, statements] = await Promise.all([loadProfile(), listStatements()]);
        if (!alive) return;
        const split = splitProfile(text);
        dispatch({
          type: "load",
          declared: declaredText(split),
          guesses: split.guesses,
          statements,
        });
      } catch {
        // Nothing readable, nothing to offer: the card stays unloaded and draws
        // nothing. Neither file is written on this path, so there is nothing to
        // lose by staying quiet.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const keep = async () => {
    const writes = checkedWrites(state);
    if (writes.length === 0 || state.writing) return;
    dispatch({ type: "write" });
    // Confirmed today, on the reader's own clock: these lines point at no
    // message, so the day they were kept is the only date there is
    // (memory/statements/store.ts).
    const confirmedOn = localDate(Date.now());
    const written: string[] = [];
    try {
      // One at a time. Every statement lives in one file and each write is a
      // read-modify-write of the whole of it, so writing them at once would
      // keep whichever finished last.
      for (const w of writes) {
        await createStatement({
          kind: w.kind,
          text: w.text,
          author: "reader",
          evidence: [],
          confirmedOn,
        });
        written.push(w.text);
      }
      dispatch({ type: "wrote", texts: written });
    } catch (e) {
      // What did get written still leaves the list, so a second press does not
      // write it again.
      dispatch({ type: "wrote", texts: written });
      dispatch({ type: "fail", message: e instanceof Error ? e.message : String(e) });
    }
  };

  if (!state.loaded) return null;
  // Gone once every line has been dealt with, and not before the count of what
  // the last press wrote has been read.
  if (state.lines.length === 0 && state.wrote === null) return null;
  const groups = groupLines(state.lines);

  return (
    <div className={CARD}>
      <p className="m-0 text-xs text-[#777]">
        These are the things an earlier version of this app had written down about you. Tick the
        ones that still hold and they are kept as your own words, which is what the AI goes by from
        now on. The rest stop being read — the files stay on disk either way.
      </p>

      {groups.declared.length > 0 && (
        <Group title="You wrote" lines={groups.declared} state={state} dispatch={dispatch} />
      )}
      {groups.guessed.length > 0 && (
        <Group title="The AI guessed" lines={groups.guessed} state={state} dispatch={dispatch} />
      )}

      {state.lines.length > 0 && (
        <div>
          <Button
            type="button"
            disabled={state.writing || checkedWrites(state).length === 0}
            onClick={() => void keep()}
          >
            {state.writing ? "Keeping…" : "Keep the checked lines as your own"}
          </Button>
        </div>
      )}

      {state.wrote !== null && state.wrote > 0 && (
        <p className="m-0 text-xs text-[#777]">{writtenNote(state.wrote)}</p>
      )}
      {state.error && <p className="m-0 text-xs text-[#b91c1c]">{state.error}</p>}
    </div>
  );
}

function Group({
  title,
  lines,
  state,
  dispatch,
}: {
  title: string;
  lines: ProfileLine[];
  state: ProfileLinesState;
  dispatch: (action: ProfileLinesAction) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-xs font-medium text-[#555]">{title}</p>
      {lines.map((line) => {
        const pick = state.picks[line.text];
        return (
          <div key={line.text} className="flex items-start gap-3">
            <Label className="min-w-0 flex-1 items-start gap-2 leading-5">
              {/* The box is 16px and the line of text is 20px tall, so it is
                  centred against the first line rather than the paragraph. */}
              <span className="flex h-5 shrink-0 items-center">
                <Checkbox
                  checked={pick.checked}
                  disabled={state.writing}
                  onCheckedChange={() => dispatch({ type: "toggle", text: line.text })}
                />
              </span>
              <span className="min-w-0 flex-1 break-words">{line.text}</span>
            </Label>
            <div className="flex shrink-0 gap-1">
              {KINDS.map((k) => (
                <Button
                  key={k.value}
                  type="button"
                  size="xs"
                  variant={pick.kind === k.value ? "secondary" : "subtle"}
                  aria-pressed={pick.kind === k.value}
                  disabled={state.writing}
                  onClick={() => dispatch({ type: "kind", text: line.text, kind: k.value })}
                >
                  {k.label}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
