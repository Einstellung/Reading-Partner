// The receipt for a write to the talk outline (docs/44). Four variants of one
// card, because a write is bounded to one thing and the reader has to be able to
// see which thing: the spine, one segment, a segment dropped, a segment moved.
//
// Read-only, like the decision card next to it. The talk is corrected by saying
// so to the AI, which rewrites the block and raises a fresh card. Presentational,
// Tailwind-only.

import type { ReactNode } from "react";
import type { TalkArrangementCardData } from "../../../reading/retell/cards";
import type { CardComponentProps } from "../chat/chatParts";
import { t } from "../../../i18n";
import { Badge } from "../ui/badge";

function Shell({ eyebrow, badge, badgeVariant, children }: {
  eyebrow: string;
  badge: string;
  badgeVariant?: "source" | "aside";
  children?: ReactNode;
}) {
  return (
    <div className="w-full max-w-md rounded-xl border border-black/10 bg-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
          {eyebrow}
        </span>
        <span className="flex-1" />
        <Badge className="shrink-0" variant={badgeVariant}>
          {badge}
        </Badge>
      </div>
      {children}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 text-[12px] leading-snug text-muted-foreground">
      <span className="text-faint-foreground">{label}: </span>
      {value}
    </div>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
      {items.map((text, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
          <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-muted-strong" />
          <span className="min-w-0 flex-1">{text}</span>
        </li>
      ))}
    </ul>
  );
}

// How much of a block the receipt shows. Enough to recognise which one it is;
// the block itself is read where the note is read.
const PREVIEW_LINES = 4;

function preview(body: string): string {
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const head = lines.slice(0, PREVIEW_LINES).join("\n");
  return lines.length > PREVIEW_LINES ? `${head}\n…` : head;
}

// Not useT(): see the note on RetellCard.tsx — this is also walked as a plain
// function by talk-arrangement-card.test.tsx, outside any React render.
export function TalkArrangementCard({ payload }: CardComponentProps<TalkArrangementCardData>) {
  const theTalk = t("reader.talk.theTalk");

  if (payload.change === "spine") {
    const s = payload.spine;
    return (
      <Shell eyebrow={theTalk} badge={t("reader.talk.spine")}>
        <div className="mt-1 text-[15px] font-medium leading-snug text-foreground">
          {s.thesis || t("reader.talk.noThroughLine")}
        </div>
        {s.audience && <Line label={t("reader.talk.for")} value={s.audience} />}
        {s.backbone.length > 0 && <Bullets items={s.backbone} />}
        {s.conventions.length > 0 && (
          <Line label={t("reader.talk.throughout")} value={s.conventions.join("; ")} />
        )}
        {s.excluded.length > 0 && (
          <Line label={t("reader.talk.notGoingInto")} value={s.excluded.join("; ")} />
        )}
      </Shell>
    );
  }

  if (payload.change === "removed") {
    return (
      <Shell eyebrow={theTalk} badge={t("reader.talk.dropped")} badgeVariant="aside">
        <div className="mt-1 text-[15px] font-medium text-foreground line-through decoration-faint-foreground">
          {payload.title || t("reader.talk.untitledSegment")}
        </div>
        <div className="mt-2 text-[12px] text-faint-foreground">
          {t("reader.talk.segmentsLeft", { count: payload.total })}
        </div>
      </Shell>
    );
  }

  if (payload.change === "moved") {
    return (
      <Shell eyebrow={theTalk} badge={t("reader.talk.moved")} badgeVariant="aside">
        <div className="mt-1 text-[15px] font-medium text-foreground">
          {payload.title || t("reader.talk.untitledSegment")}
        </div>
        <div className="mt-2 text-[12px] text-faint-foreground">
          {t("reader.talk.nowSegment", { position: payload.position, total: payload.total })}
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      eyebrow={t("reader.talk.blockOf", { position: payload.position, total: payload.total })}
      badge={t("reader.talk.written")}
    >
      {/* The head of the block, as it was written — markdown source and not
          rendered markdown. This is a receipt saying which block landed, and a
          second place to read the note would be a second note. */}
      <div className="mt-1.5 whitespace-pre-line text-[13px] leading-snug text-muted-foreground">
        {preview(payload.body)}
      </div>
    </Shell>
  );
}
