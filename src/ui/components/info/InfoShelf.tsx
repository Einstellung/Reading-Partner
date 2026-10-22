// The info shelf (docs/info/88 「info 书架与专题册」): the nightly brief's issues
// newest first, and the topic volumes in a row of their own. One screen for both
// shells; the phone gives it a back and a bottom sheet for Move to…. What is on
// it and what Move to… does are in info-shelf.ts. A study's cover has its own
// menu item to move it into reading and end the study (docs/info/91 结束): it
// raises end_study's move card as the confirmation (companion/study-end.ts).

import { prepareStudyBook } from "../reader/study/study-live";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../../i18n";
import { todayLocal } from "../../../info/collect/store";
import { studySearchIdOf } from "../../../info/issue/study-reader";
import { STUDY_MOVE_LATER_OP, STUDY_MOVE_OP, type StudyMoveCardData } from "../../../info/topic-search/cards";
import { parseMoveTarget } from "../../../info/topic-search/study-lines";
import { appData } from "../../../platform/app/appdata";
import { listLibraryEntries } from "../../../platform/app/library";
import { getViewState } from "../../../platform/app/storage";
import { addFileToTopic, listTopics, type Topic } from "../../../platform/app/topics";
import { deleteBook } from "../../../reading/delete/delete-book";
import ConfirmDestructiveDialog from "../common/ConfirmDestructiveDialog";
import { useCompanionName } from "../base/use-companion-name";
import type { CardAction } from "../chat/chatParts";
import { StudyMoveCard } from "../companion/StudyMoveCard";
import { endStudyLive, shelfStudyMoveCardLive } from "../companion/study-end";
import CardMenu from "../shelf/CardMenu";
import MoveToTopicDialog from "../shelf/MoveToTopicDialog";
import { moveFailedLine, moveTargets } from "../shelf/move-to";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogSheetContent, DialogTitle } from "../ui/dialog";
import { cn } from "../lib/utils";
import {
  cardBookName,
  fileVolume,
  infoShelfView,
  loadInfoShelf,
  type InfoShelfData,
  type InfoShelfIo,
  type IssueCard,
  type VolumeCard,
} from "./info-shelf";

const liveIo: InfoShelfIo = {
  readText: async (path) => ((await appData.exists(path)) ? await appData.readText(path) : null),
  library: listLibraryEntries,
  topics: listTopics,
  opened: async (bookId) => (await getViewState(bookId)) !== null,
  today: () => todayLocal(),
};

export default function InfoShelf(props: {
  onOpenBook: (bookId: string, name: string) => void;
  // The phone's way home; the desk has its sidebar.
  onBack?: () => void;
  // Move to… off the bottom edge (the phone) rather than centred.
  sheet?: boolean;
  onTell: (line: string) => void;
  onSay: (line: string) => void;
  // A volume went onto a reading topic: the shell's shelf has to reread.
  onTopicsChanged?: () => Promise<void> | void;
  io?: InfoShelfIo;
}) {
  const t = useT();
  const companionName = useCompanionName();
  const io = props.io ?? liveIo;
  const [data, setData] = useState<InfoShelfData | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [moving, setMoving] = useState<VolumeCard | null>(null);
  const [removing, setRemoving] = useState<VolumeCard | null>(null);
  const [ending, setEnding] = useState<StudyMoveCardData | null>(null);
  const endingBusy = useRef(false);

  const reload = useCallback(async () => {
    try {
      const [next, all] = await Promise.all([loadInfoShelf(io), io.topics()]);
      setData(next);
      setTopics(all);
    } catch (e) {
      console.warn("the info shelf would not read", e);
    }
  }, [io]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const view = data ? infoShelfView(data.shelf, data.ctx) : null;
  // A study's newest version takes the reader's marks from the one before it first (docs/info/91 「版本」).
  const open = (card: IssueCard | VolumeCard) => {
    const go = () => props.onOpenBook(card.bookId, cardBookName(card, data?.ctx.library ?? {}));
    if ("study" in card && card.study) void prepareStudyBook(card.bookId).catch(() => null).finally(go);
    else go();
  };

  const startEnding = (issue: IssueCard) => {
    if (!issue.study) return;
    void shelfStudyMoveCardLive(studySearchIdOf(issue), issue.study.name)
      .then((card) => (card ? setEnding(card) : props.onSay(moveFailedLine())))
      .catch(() => props.onSay(moveFailedLine()));
  };
  // The move card's presses: its go ends the study (the door's moveStudy does the same), its later closes it.
  const onEndingAction = (action: CardAction) => {
    if (action.kind !== "mutate" || !ending) return;
    if (action.op === STUDY_MOVE_LATER_OP) return setEnding(null);
    const target = parseMoveTarget(action.arg);
    if (action.op !== STUDY_MOVE_OP || !target || endingBusy.current) return;
    endingBusy.current = true;
    const card = ending;
    void (async () => {
      try {
        const moved = await endStudyLive(card, target);
        setEnding(moved ?? { ...card, failed: true });
        if (moved?.moved) await props.onTopicsChanged?.();
      } finally {
        endingBusy.current = false;
      }
      await reload();
    })();
  };
  const EndingContent = props.sheet ? DialogSheetContent : DialogContent;

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-4 pt-5 pb-28 sm:px-6 sm:pt-8">
        <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 border-b border-border-subtle bg-background/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {props.onBack && (
            <Button variant="subtle" size="chip" onClick={props.onBack}>
              ‹ {t("info.shelf.back")}
            </Button>
          )}
          <h1 className="m-0 text-[17px] font-semibold text-foreground">{t("info.shelf.title")}</h1>
        </div>

        <h2 className="mt-0 mb-3 text-[12px] font-medium tracking-[0.08em] text-faint-foreground uppercase">
          {t("info.shelf.issues")}
        </h2>
        {view && view.issues.length === 0 && (
          <p className="m-0 mb-6 text-[14px] leading-relaxed text-faint-foreground">{t("info.shelf.empty", { name: companionName })}</p>
        )}
        <ul className="m-0 mb-8 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {view?.issues.map((issue) => (
            <li key={issue.key} className="relative">
              <button
                className={cn(
                  "relative flex aspect-[4/5] w-full flex-col rounded-xl border bg-card p-4 text-left active:bg-muted",
                  issue.study ? "border-accent-line" : "border-border-soft can-hover:hover:border-secondary-border",
                )}
                onClick={() => open(issue)}
              >
                <span
                  className={cn(
                    "text-[11px] font-medium tracking-[0.08em] uppercase",
                    issue.study ? "text-accent-line" : "text-faint-foreground",
                  )}
                >
                  {issue.title}
                </span>
                {issue.study ? (
                  <span className="flex flex-1 items-center">
                    <span className="line-clamp-4 font-serif text-[20px] leading-snug text-foreground">{issue.study.name}</span>
                  </span>
                ) : (
                  <span className="flex flex-1 items-center font-serif text-[30px] leading-tight text-foreground">{issue.dateLabel}</span>
                )}
                <span className="flex flex-col gap-1">
                  {!issue.study && (
                    <span className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{issue.topicsLine}</span>
                  )}
                  <span className="text-[12px] text-faint-foreground">{issue.itemsLine}</span>
                </span>
                {issue.isNew && (
                  <span className="absolute top-3 right-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-primary-foreground uppercase">
                    {t("info.shelf.new")}
                  </span>
                )}
              </button>
              {issue.study && (
                <div className="absolute right-1 bottom-1">
                  <CardMenu
                    label={t("info.shelf.menu")}
                    items={[
                      { label: t("info.shelf.open"), onSelect: () => open(issue) },
                      { label: t("info.shelf.endStudy"), onSelect: () => startEnding(issue) },
                    ]}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>

        <h2 className="mt-0 mb-3 text-[12px] font-medium tracking-[0.08em] text-faint-foreground uppercase">
          {t("info.shelf.volumes")}
        </h2>
        {view && view.volumes.length === 0 && (
          <p className="m-0 text-[14px] text-faint-foreground">{t("info.shelf.volumesEmpty")}</p>
        )}
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {view?.volumes.map((volume) => (
            <li
              key={volume.id}
              className="flex items-center gap-2 rounded-xl border border-border-soft bg-card py-2 pr-2 pl-4"
            >
              <button
                className={cn(
                  "min-w-0 flex-1 py-2 text-left text-[15px] leading-snug font-medium text-foreground [overflow-wrap:anywhere] coarse:min-h-[44px]",
                )}
                onClick={() => open(volume)}
              >
                {volume.title}
              </button>
              <CardMenu
                label={t("info.shelf.menu")}
                items={[
                  { label: t("info.shelf.open"), onSelect: () => open(volume) },
                  { label: t("info.shelf.moveTo"), onSelect: () => setMoving(volume) },
                  { label: t("info.shelf.delete"), onSelect: () => setRemoving(volume), destructive: true },
                ]}
              />
            </li>
          ))}
        </ul>
      </div>

      {moving && (
        <MoveToTopicDialog
          open
          sheet={props.sheet}
          fileName={moving.title}
          // On no topic yet, so none is Here.
          targets={moveTargets(topics, "")}
          onOpenChange={(next) => !next && setMoving(null)}
          onPick={(to) => {
            const volume = moving;
            setMoving(null);
            void (async () => {
              try {
                const line = await fileVolume(volume, data?.ctx.library[volume.bookId], to, { addFileToTopic });
                props.onTell(line);
                await props.onTopicsChanged?.();
              } catch (e) {
                console.warn("the volume could not be filed", e);
                props.onSay(moveFailedLine());
              }
              await reload();
            })();
          }}
        />
      )}

      {ending && (
        <Dialog open onOpenChange={(next) => !next && setEnding(null)}>
          <EndingContent className={props.sheet ? "px-3 pb-safe-4" : "p-3 sm:max-w-md"}>
            <DialogTitle className="sr-only">{t("info.shelf.endStudy")}</DialogTitle>
            <StudyMoveCard payload={ending} dispatch={onEndingAction} surface="bubble" />
          </EndingContent>
        </Dialog>
      )}

      {removing && (
        <ConfirmDestructiveDialog
          title={t("info.shelf.deleteTitle", { title: removing.title })}
          description={t("info.shelf.deleteBody")}
          open
          onOpenChange={(next) => !next && setRemoving(null)}
          onConfirm={() => {
            const volume = removing;
            setRemoving(null);
            void (async () => {
              try {
                await deleteBook(volume.bookId);
              } catch (e) {
                console.warn("the volume could not be deleted", e);
                props.onSay(t("info.shelf.deleteFailed"));
              }
              await reload();
            })();
          }}
        />
      )}
    </div>
  );
}
