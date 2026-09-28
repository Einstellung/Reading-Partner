// The Retell section of a topic (docs/31, "界面"): the retells being prepared under
// this topic, each one openable back into its own retell conversation.
//
// A row says how far its retell has got and nothing else. What comes out of a
// retell is the talk note (docs/44), and the note is opened from the topic's
// Rehearsal section, so there is no second product to show here.

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../../../i18n";
import { logEvent } from "../../../../platform/app/events";
import type { Topic } from "../../../../platform/app/topics";
import { deleteRetellWithTalk } from "../../../../reading/delete/delete-retell";
import {
  createRetell,
  listRetellsForTopic,
  retellCandidates,
  retellRows,
  retellSummary,
  type MaterialCandidate,
  type RetellRow,
} from "../../../../reading/retell";
import { Button } from "../../ui/button";
import CardMenu from "../../shelf/CardMenu";
import { displayFileTitle } from "../../shelf/file-title";
import ConfirmDestructiveDialog from "../../common/ConfirmDestructiveDialog";
import { settleDelete } from "../../common/settle-delete";
import NewRetellDialog from "./NewRetellDialog";

const ROW = "flex items-center gap-2 rounded-lg border border-border py-1 pl-3 pr-1.5";

export default function RetellSection(props: {
  topic: Topic;
  onOpenRetell: (retellId: string) => void;
}) {
  const t = useT();
  const { topic, onOpenRetell } = props;
  // null while loading; [] when this topic has no retells.
  const [rows, setRows] = useState<RetellRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RetellRow | null>(null);
  const [candidates, setCandidates] = useState<MaterialCandidate[]>([]);

  const load = useCallback(
    async () => retellRows(await listRetellsForTopic(topic.id)),
    [topic.id],
  );
  const refresh = useCallback(async () => setRows(await load()), [load]);

  // Both outcomes are dropped once the topic has changed: a read for the topic
  // just left can finish after the one for the topic now shown.
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void load().then(
      (r) => {
        if (!cancelled) setRows(r);
      },
      () => {
        if (!cancelled) setRows([]);
      },
    );
    void retellCandidates(topic, displayFileTitle).then((c) => {
      if (!cancelled) setCandidates(c);
    });
    return () => {
      cancelled = true;
    };
  }, [topic, load]);

  const create = useCallback(
    async (bookIds: string[]) => {
      setError(null);
      try {
        const picked = candidates.filter((c) => bookIds.includes(c.bookId));
        const retell = await createRetell(
          topic.id,
          picked.map(({ bookId, title }) => ({ bookId, title })),
        );
        onOpenRetell(retell.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("library.retell.startFailed"));
      }
    },
    [candidates, topic.id, onOpenRetell, t],
  );

  return (
    <>
      {error && <p className="mt-0 mb-3 text-sm text-destructive">{error}</p>}

      {rows === null ? (
        <p className="m-0 text-sm text-muted-foreground">{t("library.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="max-w-prose">
          <p className="m-0 mb-4 text-sm text-muted-foreground">{t("library.retell.emptyBlurb")}</p>
          <Button onClick={() => setCreating(true)}>{t("library.retell.newRetellButton")}</Button>
        </div>
      ) : (
        <>
          <ul className="m-0 mb-3 flex list-none flex-col gap-1.5 p-0">
            {rows.map((row) => (
              <li key={row.id} className={ROW}>
                <button
                  className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 border-0 bg-transparent px-0 py-2 text-left"
                  onClick={() => {
                    logEvent(topic.id, "talk-open", { retellId: row.id });
                    onOpenRetell(row.id);
                  }}
                >
                  <span className="truncate text-[15px]">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{retellSummary(row)}</span>
                </button>
                <CardMenu
                  label={t("library.card.actionsFor", { name: row.name })}
                  items={[
                    {
                      label: t("library.retell.deleteMenuItem"),
                      destructive: true,
                      onSelect: () => setDeleting(row),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => setCreating(true)}>
            {t("library.retell.newRetellButton")}
          </Button>
        </>
      )}

      {deleting && (
        <ConfirmDestructiveDialog
          title={t("library.deleteTitle", { name: deleting.name })}
          description={t("library.retell.deleteDescription")}
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          onConfirm={() => {
            setError(null);
            void settleDelete({
              act: () => deleteRetellWithTalk(deleting.id),
              refresh,
              failed: t("library.deleteFailed", { name: deleting.name }),
              onFail: setError,
            });
          }}
        />
      )}

      {creating && (
        <NewRetellDialog
          open
          onOpenChange={setCreating}
          candidates={candidates}
          onConfirm={(ids) => void create(ids)}
        />
      )}
    </>
  );
}
