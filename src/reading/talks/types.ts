// A talk (docs/31, "讲是一个对象，不是一个按钮"): one preparation of one talk,
// living under a topic, spanning one or more materials, holding its own
// conversation and the decisions that conversation produced.
//
// It is not a mode and not a book: the rehearsal conversation is anchored on the
// talk, so it survives the book being closed and it can cover several books at
// once. The decisions therefore say which book's chapter they are about — a
// chapter number alone stops meaning anything the moment a second material joins.
//
// The id is shared with the deck: slides/<talkId>/ is where the deck this talk
// produces keeps its state and its pages (reading/slides/store.ts). One id, one
// talk, whichever end you come at it from.

export const TALK_VERSION = 1 as const;

// One material in a talk: a book id (the library content hash everything else is
// keyed by) plus the title at the time it was added, so a list can be drawn
// without opening the library.
export interface TalkMaterial {
  bookId: string;
  title: string;
}

// What the rehearsal settled about one chapter of one material. The same shape
// the rehearsal has always produced (reading/rehearsal/types.ts), plus the book
// it belongs to.
export interface TalkDecision {
  bookId: string;
  // 1-based chapter index inside that material's own skeleton.
  chapter: number;
  // The chapter's title when the decision was made, kept so the entry still
  // reads as something if the skeleton later shifts.
  title: string;
  // Whether the chapter goes in the talk. A cut chapter stays in the list: it is
  // a settled question, and dropping it would make the AI ask it again.
  include: boolean;
  // What it contributes, in the reader's own framing. Empty for a cut chapter.
  points: string[];
  // The figure that carries it, as a [fig:N] id or a plain description.
  figure?: string;
  // One line of why, when the exchange produced one.
  note?: string;
  updatedAt: number;
}

// The talk file. `decisions` is the outline, in the order it will be given:
// recording appends, and the reader can move an entry or remove it (outline.ts).
// One array, not two — the outline the reader arranges and the record the AI
// reads are the same thing (docs/31).
export interface Talk {
  version: typeof TALK_VERSION;
  id: string;
  name: string;
  topicId: string;
  materials: TalkMaterial[];
  createdAt: number;
  updatedAt: number;
  decisions: TalkDecision[];
}

// A new talk id. The creation timestamp, like the deck's (reading/slides/live.ts
// mints the same shape), so the two cannot disagree about what a talk id looks
// like.
export function newTalkId(now: number): string {
  return `${now}`;
}

// The default name for a talk started from one material: the material's title.
// The reader renames it from the list.
export function defaultTalkName(materials: readonly TalkMaterial[]): string {
  if (materials.length === 0) return "Untitled talk";
  if (materials.length === 1) return materials[0].title;
  return `${materials[0].title} +${materials.length - 1}`;
}

export interface CreateTalkInput {
  id: string;
  topicId: string;
  materials: TalkMaterial[];
  name?: string;
  now: number;
}

export function createTalk(input: CreateTalkInput): Talk {
  return {
    version: TALK_VERSION,
    id: input.id,
    name: (input.name ?? "").trim() || defaultTalkName(input.materials),
    topicId: input.topicId,
    materials: input.materials,
    createdAt: input.now,
    updatedAt: input.now,
    decisions: [],
  };
}

// A load-time repair. A file this build cannot use at all reads as null in the
// store; anything merely odd inside a usable file is dropped rather than
// crashing the talk — a lost decision is re-made in one exchange, an unopenable
// talk is not.
export function normalizeTalk(talk: Talk): Talk | null {
  if (!talk || talk.version !== TALK_VERSION) return null;
  if (typeof talk.id !== "string" || !talk.id) return null;
  if (typeof talk.topicId !== "string" || !talk.topicId) return null;
  const materials: TalkMaterial[] = [];
  const seenBooks = new Set<string>();
  for (const m of talk.materials ?? []) {
    const bookId = typeof m?.bookId === "string" ? m.bookId : "";
    if (!bookId || seenBooks.has(bookId)) continue;
    seenBooks.add(bookId);
    materials.push({ bookId, title: typeof m.title === "string" ? m.title : bookId });
  }
  const decisions: TalkDecision[] = [];
  const seen = new Set<string>();
  for (const d of talk.decisions ?? []) {
    const bookId = typeof d?.bookId === "string" ? d.bookId : "";
    const chapter = Math.round(Number(d?.chapter));
    if (!bookId || !Number.isFinite(chapter) || chapter < 1) continue;
    const key = `${bookId}#${chapter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    decisions.push({
      bookId,
      chapter,
      title: typeof d.title === "string" ? d.title : "",
      include: !!d.include,
      points: Array.isArray(d.points) ? d.points.filter((p) => typeof p === "string") : [],
      ...(typeof d.figure === "string" && d.figure ? { figure: d.figure } : {}),
      ...(typeof d.note === "string" && d.note ? { note: d.note } : {}),
      updatedAt: Number.isFinite(d.updatedAt) ? d.updatedAt : talk.updatedAt,
    });
  }
  return {
    version: TALK_VERSION,
    id: talk.id,
    name: typeof talk.name === "string" && talk.name.trim() ? talk.name : defaultTalkName(materials),
    topicId: talk.topicId,
    materials,
    createdAt: Number.isFinite(talk.createdAt) ? talk.createdAt : 0,
    updatedAt: Number.isFinite(talk.updatedAt) ? talk.updatedAt : 0,
    decisions,
  };
}
