// How fast each source of a topic search reads, and the first look delivered
// in two parts by it (docs/info/88 「第一次分两段」). A fast source is plain
// HTTP (arXiv, Hugging Face); a slow one is read at a person's pace in the browse window (X,
// and later other social media). The first look builds and delivers what the
// fast sources found without waiting, then reads the slow ones and adds what
// they found to the same result file, the way a retry does (retry.ts), with a
// brief issue of its own.
//
// The split is meant to be merged back into one delivery later: set
// SPLIT_FIRST_LOOK to false and the first look reads every source in one read
// phase again, as daily runs and retries do. Everything the split adds keys
// off `RunPart` ("fast" / "slow"), so it can then be taken out by deleting what
// reads it.

/** The sources a run reads. */
export type RunSource = "x" | "arxiv" | "huggingface";

export type Pace = "fast" | "slow";

export const SOURCE_PACE: Readonly<Record<RunSource, Pace>> = { x: "slow", arxiv: "fast", huggingface: "fast" };

/** How a source is named to the reader and to the companion. */
export const SOURCE_NAME: Readonly<Record<RunSource, string>> = { x: "X", arxiv: "arXiv", huggingface: "Hugging Face" };

/** Whether the first look delivers its fast sources first and adds the slow ones after. */
export const SPLIT_FIRST_LOOK = true;

/** Which part of a split first look a phase is in: the fast sources, or the slow ones added after. */
export type RunPart = "fast" | "slow";

export function sourcesOfPace(pace: Pace): RunSource[] {
  return (Object.keys(SOURCE_PACE) as RunSource[]).filter((s) => SOURCE_PACE[s] === pace);
}

/** Every source, in the order runs name them. */
export const ALL_SOURCES: readonly RunSource[] = Object.keys(SOURCE_PACE) as RunSource[];

/** What a topic says it reads (docs/info/91 来源开关); its config is read through this alone. */
export interface TopicSources {
  sources?: readonly RunSource[];
}

/** The sources a topic's runs read: those its config names, every source for a config without the field. */
export function topicSources(topic: TopicSources | null | undefined): RunSource[] {
  if (!topic?.sources) return [...ALL_SOURCES];
  return ALL_SOURCES.filter((s) => topic.sources!.includes(s));
}

/** Whether a topic's runs read this source. */
export function readsSource(topic: TopicSources | null | undefined, source: RunSource): boolean {
  return topicSources(topic).includes(source);
}

/** The sources a part reads, of those the topic reads; all of the topic's when the run is not split (null). */
export function sourcesOf(part: RunPart | null, topic?: TopicSources | null): RunSource[] {
  const own = topicSources(topic);
  return part ? sourcesOfPace(part).filter((s) => own.includes(s)) : own;
}

/**
 * Whether a run of this kind is a split first look. Only a topic that reads
 * both a fast and a slow source is split; one without X reads in one go.
 * Without the topic (a caller that has none at hand), every source is assumed.
 */
export function splitsFirstLook(kind: string, topic?: TopicSources | null): boolean {
  if (!SPLIT_FIRST_LOOK || kind !== "first") return false;
  const own = topicSources(topic);
  return own.some((s) => SOURCE_PACE[s] === "fast") && own.some((s) => SOURCE_PACE[s] === "slow");
}

/** "X", "X and Bluesky", "X, Bluesky and Reddit". */
export function sourceNames(sources: readonly RunSource[]): string {
  const names = sources.map((s) => SOURCE_NAME[s]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
