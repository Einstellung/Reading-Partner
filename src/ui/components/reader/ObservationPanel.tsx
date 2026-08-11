// AI observations panel (docs/02 part 2): the "see what the AI noticed" face of
// the per-topic observations. Read-only by design — corrections go through
// conversation ("you got that wrong"), never direct editing. Same plain visual
// pattern as the prep panel.

import { useState } from "react";
import type { Observation, ObservationType } from "../../../observation";
import { CitationContext, Markdown } from "../common/Markdown";

const TYPE_STYLE: Record<ObservationType, string> = {
  "reading-position": "bg-sky-100 text-sky-700",
  "stuck-point": "bg-amber-100 text-amber-700",
  "cannot-explain": "bg-orange-100 text-orange-700",
  "can-explain": "bg-teal-100 text-teal-700",
  "understood-concept": "bg-green-100 text-green-700",
  belief: "bg-violet-100 text-violet-700",
  correction: "bg-red-100 text-red-700",
};

interface ObservationPanelProps {
  // null while loading; [] when the topic has no observations yet.
  entries: Observation[] | null;
  lastDistilledAt: number | null;
}

function ObservationRow({ entry }: { entry: Observation }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="border-b border-[#eee] px-3 py-2">
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
        <div className="mt-2 rounded-md bg-[#fafafa] p-2 text-[12px] text-neutral-700">
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

export default function ObservationPanel({ entries, lastDistilledAt }: ObservationPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#eee] px-3 py-2">
        <div className="text-[13px] text-foreground">AI observations</div>
        <div className="mt-0.5 text-[11px] text-neutral-400">
          {lastDistilledAt
            ? `Last distilled ${new Date(lastDistilledAt).toLocaleString()}`
            : "No distillation has run yet."}
        </div>
      </div>

      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
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

      <div className="border-t border-[#eee] px-3 py-2 text-[11px] text-neutral-400">
        Observations are maintained by the AI. If one is off, say so in a conversation.
      </div>
    </div>
  );
}
