// AI observations panel (docs/02 part 2): the "see what the AI noticed" face of
// the per-topic observations. Read-only by design — corrections go through
// conversation ("you got that wrong"), never direct editing. Same plain visual
// pattern as the prep panel.

import { useState } from "react";
import type { Observation, ObservationConflict, ObservationType, Statement } from "../../../memory";
import { CitationContext, Markdown } from "../markdown/Markdown";
import { statementRows, type StatementRow } from "./statements-view";

const TYPE_STYLE: Record<ObservationType, string> = {
  "reading-position": "bg-sky-100 text-sky-700",
  "stuck-point": "bg-amber-100 text-amber-700",
  "cannot-explain": "bg-orange-100 text-orange-700",
  "can-explain": "bg-teal-100 text-teal-700",
  "understood-concept": "bg-green-100 text-green-700",
  belief: "bg-violet-100 text-violet-700",
  correction: "bg-red-100 text-red-700",
};

const KIND_STYLE: Record<Statement["kind"], string> = {
  profile: "bg-indigo-100 text-indigo-700",
  concern: "bg-fuchsia-100 text-fuchsia-700",
};

interface ObservationPanelProps {
  // null while loading; [] when the topic has no observations yet.
  entries: Observation[] | null;
  // What is held to be true about the reader (docs/48). Not per topic — a
  // statement is about the reader, not about what they were reading when it was
  // concluded — so the same list shows under every topic.
  statements: Statement[];
  lastDistilledAt: number | null;
  // Versions sync kept when two devices changed the same observation. Read-only
  // here on purpose: this panel exists so the reader knows a copy is there and
  // can find it, not so they can resolve it — resolving is a conversation.
  conflicts: ObservationConflict[];
}

// What is held to be true about the reader, read-only like everything else in
// this panel: a wrong one is corrected by saying so in a conversation, which
// writes a statement that supersedes it and takes it off this list. A delete
// button would be the one way to lose the reasoning with the claim.
//
// Nothing at all when there are none — a heading over an empty list is a
// statement about the reader too, and not one anybody made.
function StatementList({ rows }: { rows: StatementRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="border-b border-border-subtle px-3 py-2">
      <div className="text-[13px] text-foreground">About you</div>
      <ul className="m-0 mt-2 list-none space-y-2.5 p-0">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="text-[13px] leading-snug text-foreground">{row.text}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${KIND_STYLE[row.kind]}`}
              >
                {row.kind}
              </span>
              <span className="text-[11px] text-neutral-400">{row.author}</span>
              <span className="text-[11px] text-neutral-400">
                last supported {row.lastSupported}
              </span>
              {row.evidence !== "" && (
                <span className="text-[11px] text-neutral-400">from {row.evidence}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ObservationRow({ entry }: { entry: Observation }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="border-b border-border-subtle px-3 py-2">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-col items-start gap-1 border-0 bg-transparent p-0 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[13px] leading-snug text-foreground">{entry.summary}</span>
        <span className="flex items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${TYPE_STYLE[entry.type]}`}>
            {entry.type}
          </span>
          <span className="text-[11px] text-neutral-400">updated {entry.updated}</span>
        </span>
      </button>
      {expanded && (
        <div className="mt-2 rounded-md bg-muted-faint p-2 text-[12px] text-neutral-700">
          <CitationContext.Provider value={null}>
            <Markdown text={entry.body} />
          </CitationContext.Provider>
          {(entry.anchors.annotationIds.length > 0 || entry.anchors.messageIds.length > 0) && (
            <div className="mt-1.5 text-[10px] text-neutral-400">
              Evidence:{" "}
              {[
                ...entry.anchors.annotationIds.map((id) => `annotation ${id}`),
                ...entry.anchors.messageIds.map((id) => `message ${id}`),
              ].join(", ")}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// The conflict copies. A line that never appears on a library that has none, and
// on one that has some says how many and names the file each is in — nothing
// behind a disclosure, because a copy the reader has to click to learn the path
// of is barely less hidden than one nothing mentions at all.
//
// It stops at showing them. Resolving a conflict is a conversation ("keep the
// iPad's version of that one"), not a merge screen.
function ConflictNotice({ conflicts }: { conflicts: ObservationConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
      <div>
        {conflicts.length === 1 ? "1 conflict copy" : `${conflicts.length} conflict copies`} from
        sync. Two devices changed the same observation; the version that lost is kept beside it.
      </div>
      <ul className="m-0 mt-1.5 list-none space-y-1.5 p-0">
        {conflicts.map((c) => (
          <li key={c.path}>
            <div className="font-mono text-[10px] break-all text-amber-700">{c.path}</div>
            <div className="text-amber-900">
              {c.summary || "(this copy could not be read; open the file to see it)"}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ObservationPanel({
  entries,
  statements,
  lastDistilledAt,
  conflicts,
}: ObservationPanelProps) {
  const rows = statementRows(statements);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border-subtle px-3 py-2">
        <div className="text-[13px] text-foreground">AI observations</div>
        <div className="mt-0.5 text-[11px] text-neutral-400">
          {lastDistilledAt
            ? `Last distilled ${new Date(lastDistilledAt).toLocaleString()}`
            : "No distillation has run yet."}
        </div>
      </div>

      <ConflictNotice conflicts={conflicts} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <StatementList rows={rows} />
        <ul className="m-0 list-none p-0">
          {entries === null && (
            <li className="px-3 py-4 text-center text-sm text-neutral-400">Loading…</li>
          )}
          {entries !== null && entries.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-neutral-400">
              Nothing observed yet. Observations are distilled when a conversation ends.
            </li>
          )}
          {entries?.map((e) => <ObservationRow key={e.id} entry={e} />)}
        </ul>
      </div>

      <div className="border-t border-border-subtle px-3 py-2 text-[11px] text-neutral-400">
        Observations are maintained by the AI. If one is off, say so in a conversation.
      </div>
    </div>
  );
}
