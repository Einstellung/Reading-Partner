// The rehearsals of this retell, under the outline (docs/31). Data that is
// recorded and never shown is data that was not recorded, so the pass leaves a
// mark where the retell is: which pass it was, when, how far it got, how long it
// took, and — opened up — what was said on each page.
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

function PageRow({ page }: { page: RehearsalPage }) {
  const spent = page.leftAt === null ? null : page.leftAt - page.enteredAt;
  return (
    <li className="flex flex-col gap-0.5 border-t border-border py-1.5 first:border-t-0">
      <div className="flex items-baseline gap-1.5">
        <span className="w-5 flex-none text-[11px] tabular-nums text-muted-foreground">
          {page.index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] leading-snug">
          {page.title || <span className="text-muted-foreground">Untitled page</span>}
        </span>
        <span className="flex-none text-[11px] tabular-nums text-muted-foreground">
          {spent === null ? "—" : formatElapsed(spent)}
        </span>
      </div>
      {page.transcript && (
        <p className="m-0 pl-6 text-[11px] leading-relaxed text-muted-foreground">
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
  return (
    <ul className="m-0 list-none px-2 pb-2 pl-2">
      {pages === null ? (
        <li className="py-1.5 text-[11px] text-muted-foreground">Reading…</li>
      ) : pages.length === 0 ? (
        <li className="py-1.5 text-[11px] text-muted-foreground">No pages were recorded.</li>
      ) : (
        pages.map((p, i) => <PageRow key={`${p.index}-${i}`} page={p} />)
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
              {s.pagesSpoken} of {s.pagesTotal} pages · {s.minutes} min
              {s.wordsSpoken > 0 ? ` · ${s.wordsSpoken} words` : ""}
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
