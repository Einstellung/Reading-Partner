// The rehearsals of this retell, under the outline (docs/31). Data that is
// recorded and never shown is data that was not recorded, so the pass leaves a
// mark where the retell is: which pass it was, when, how long it ran, how much
// was said, and — opened up — the words.
//
// Deliberately a strip at the foot of a pane rather than a panel of its own.
// There is nothing to do here yet; the AI reading these runs back is the next
// round, not this one.

import { useState } from "react";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { IconChevronDown, IconChevronUp } from "../base/icons";
import {
  runSummary,
  type RehearsalPage,
  type RehearsalRunEntry,
} from "../../../reading/rehearsal";
import { formatElapsed, formatRunDate } from "./rehearsal";
import { useRunPages } from "./useRehearsal";

// One stretch of one pass. `page` is what the run calls it
// (reading/rehearsal/types.ts). A pass given from the note is one stretch and
// carries no title, so it is just the words; a pass from the days of a block at
// a time is one titled stretch per segment, and those keep their heading and
// their share of the clock.
function PageRow({ page }: { page: RehearsalPage }) {
  const spent = page.leftAt === null ? null : page.leftAt - page.enteredAt;
  return (
    <li className="flex flex-col gap-0.5 border-t border-border py-1.5 first:border-t-0">
      {page.title && (
        <div className="flex items-baseline gap-1.5">
          <span className="w-5 flex-none text-[11px] tabular-nums text-muted-foreground">
            {page.index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] leading-snug">{page.title}</span>
          <span className="flex-none text-[11px] tabular-nums text-muted-foreground">
            {spent === null ? "—" : formatElapsed(spent)}
          </span>
        </div>
      )}
      {page.transcript && (
        <p
          className={`m-0 text-[11px] leading-relaxed text-muted-foreground ${
            page.title ? "pl-6" : ""
          }`}
        >
          {page.transcript}
        </p>
      )}
    </li>
  );
}

// The transcript is read when the row is opened and not before: it is the one
// part of a pass that is measured in tens of KB, and it lives in a file of its
// own for exactly that reason (reading/rehearsal/store.ts).
function RunPages({ run }: { run: RehearsalRunEntry }) {
  const pages = useRunPages(run);
  // A pass given in silence is one stretch with nothing in it — no STT key, no
  // dictation — and an empty row would show as a rule and a gap.
  const rows = pages?.filter((p) => p.title || p.transcript.trim()) ?? null;
  return (
    <ul className="m-0 list-none px-2 pb-2 pl-2">
      {rows === null ? (
        <li className="py-1.5 text-[11px] text-muted-foreground">Reading…</li>
      ) : rows.length === 0 ? (
        <li className="py-1.5 text-[11px] text-muted-foreground">Nothing was recorded.</li>
      ) : (
        rows.map((p, i) => <PageRow key={`${p.index}-${i}`} page={p} />)
      )}
    </ul>
  );
}

function RunRow({ run }: { run: RehearsalRunEntry }) {
  const [open, setOpen] = useState(false);
  const s = runSummary(run);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-medium">
              Run {s.ordinal} · {formatRunDate(s.startedAt)}
            </span>
            <span className="block text-[11px] font-normal text-muted-foreground">
              {formatElapsed(s.elapsedMs)} · {s.wordsSpoken} words
            </span>
          </span>
          <span className="flex-none text-muted-foreground">
            {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </span>
        </Button>
      </CollapsibleTrigger>
      {open && (
        <CollapsibleContent>
          <RunPages run={run} />
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export default function RehearsalList({ runs }: { runs: RehearsalRunEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="flex-none border-t border-border bg-muted/20"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left"
          disabled={runs.length === 0}
          title={
            runs.length === 0
              ? "Give the talk once and the pass shows up here"
              : "The passes through this talk so far"
          }
        >
          <span className="min-w-0 flex-1 text-[12px] font-medium">
            Rehearsals{runs.length > 0 ? ` (${runs.length})` : ""}
          </span>
          {runs.length > 0 && (
            <span className="flex-none text-muted-foreground">
              {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            </span>
          )}
        </Button>
      </CollapsibleTrigger>
      {/* Mounted only while it is open: a closed Collapsible still renders its
          content for the height animation, and every row inside this one would
          then go and read its pass's transcript off disk. */}
      {open && (
        <CollapsibleContent>
          <div className="max-h-[40vh] overflow-y-auto px-3 pb-3">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {runs.map((run) => (
                <li key={run.id}>
                  <RunRow run={run} />
                </li>
              ))}
            </ul>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
