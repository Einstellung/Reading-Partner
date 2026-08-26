// The Rehearsal section of a topic (docs/44, "入口"): every talk under this
// topic that can be given out loud, and the door into giving it.
//
// A retell's talk is listed from the retell, and the rehearsal behind it is made
// the first time it is given. Which is why pressing a row goes through
// rehearsalForRetell rather than creating something here: the Rehearse button on
// the retell's own header lands on the same call, and the two doors must not
// leave two histories behind.
//
// The join and the wording are rehearsalRows/rehearsalSummary in
// reading/rehearsal; what is left here is the reads, the presses and the list.

import { useCallback, useEffect, useState } from "react";
import type { Topic } from "../../../../platform/app/topics";
import {
  deleteRehearsal,
  listRehearsalsForTopic,
  listAllRehearsals,
  loadRehearsalRuns,
  rehearsalForRetell,
  rehearsalRows,
  rehearsalSummary,
  type ArrangedRetell,
  type Rehearsal,
  type RehearsalRow,
  type RunCount,
} from "../../../../reading/rehearsal";
import { listTalkOutlinesForTopic } from "../../../../reading/talk";
import { listRetellsForTopic } from "../../../../reading/retell";
import { Button } from "../../ui/button";
import CardMenu from "../../shelf/CardMenu";
import DeleteRehearsalButton from "./DeleteRehearsalButton";

const ROW = "flex items-center gap-2 rounded-lg border border-border py-1 pl-3 pr-1.5";

export default function RehearsalSection(props: {
  topic: Topic;
  // Bumped by the shell when a pass has been recorded, so the counts below are
  // read again at the one moment they change.
  reloadKey: number;
  onStart: (rehearsal: Rehearsal) => void;
  // Open the talk's conversation without giving a pass first.
  onTalk: (outlineId: string) => void;
}) {
  const { topic, reloadKey, onStart, onTalk } = props;
  // null while loading; [] when this topic has nothing to rehearse.
  const [rows, setRows] = useState<RehearsalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<RehearsalRow | null>(null);

  const refresh = useCallback(async () => {
    const [rehearsals, retells, outlines] = await Promise.all([
      listRehearsalsForTopic(topic.id),
      listRetellsForTopic(topic.id),
      listTalkOutlinesForTopic(topic.id),
    ]);
    // A retell is listed once it has arranged its talk (docs/44), which is what
    // an outline of its own says.
    const arranged = new Map<string, string>();
    for (const o of outlines) if (o.retellId) arranged.set(o.retellId, o.id);
    const withTalk: ArrangedRetell[] = [];
    for (const t of retells) {
      const outlineId = arranged.get(t.id);
      if (outlineId) withTalk.push({ retellId: t.id, name: t.name, outlineId });
    }
    // One read per rehearsal, of the index alone: what a pass said is a file of
    // its own (reading/rehearsal/store.ts), so a count here costs a few hundred
    // bytes a pass however long the talk was.
    //
    // A runs file that will not open costs its own count and nothing else: this
    // list never writes a run, and the rest of the section — every other talk
    // under the topic, and the door into this one — has no reason to go with it.
    const counts = new Map<string, RunCount>();
    for (const r of rehearsals) {
      const log = await loadRehearsalRuns(r.id).catch(() => null);
      if (!log) continue;
      const last = log.runs[log.runs.length - 1];
      counts.set(r.id, { runs: log.runs.length, lastRunAt: last ? last.startedAt : null });
    }
    setRows(rehearsalRows(rehearsals, withTalk, counts));
  }, [topic.id]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void refresh().catch(() => {
      if (!cancelled) setRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, reloadKey]);

  // A row without an id is a retell's talk nobody has given yet: the object is
  // made now, which is the same call the retell's own Rehearse button makes.
  const start = useCallback(
    async (row: RehearsalRow) => {
      setError(null);
      setBusy(true);
      try {
        if (row.id) {
          const rehearsal = (await listAllRehearsals()).find((r) => r.id === row.id);
          if (!rehearsal) throw new Error("That rehearsal is no longer there");
          onStart(rehearsal);
          return;
        }
        if (!row.retellId) throw new Error("That talk has nothing to rehearse against");
        onStart(
          await rehearsalForRetell({
            topicId: topic.id,
            retellId: row.retellId,
            name: row.name,
          }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not open the rehearsal");
      } finally {
        setBusy(false);
      }
    },
    [onStart, topic.id],
  );

  return (
    <>
      {error && <p className="mt-0 mb-3 text-sm text-destructive">{error}</p>}

      {rows === null ? (
        <p className="m-0 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="m-0 max-w-prose text-sm text-muted-foreground">
          Nothing to rehearse here yet. A talk shows up here once a retell has arranged one, and
          every pass over it is kept, so the next one has something to be held against.
        </p>
      ) : (
        <ul className="m-0 mb-3 flex list-none flex-col gap-1.5 p-0">
          {rows.map((row) => (
            <li key={row.key} className={ROW}>
              <button
                className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 border-0 bg-transparent px-0 py-2 text-left"
                disabled={busy}
                onClick={() => void start(row)}
              >
                <span className="truncate text-[15px]">{row.name}</span>
                <span className="text-xs text-muted-foreground">{rehearsalSummary(row)}</span>
              </button>
              {/* The way back into the talk's conversation without giving a
                  pass first (docs/44): it spans every pass over this talk, so
                  a reply left unread after the last one is still there. */}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onTalk(row.outlineId)}
              >
                How it went
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void start(row)}>
                Rehearse
              </Button>
              {row.id && (
                <CardMenu
                  label={`Actions for ${row.name}`}
                  items={[
                    {
                      label: "Delete this rehearsal",
                      destructive: true,
                      onSelect: () => setDeleting(row),
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {deleting?.id && (
        <DeleteRehearsalButton
          name={deleting.name}
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          onDelete={() => {
            void deleteRehearsal(deleting.id as string).then(refresh);
          }}
        />
      )}
    </>
  );
}
