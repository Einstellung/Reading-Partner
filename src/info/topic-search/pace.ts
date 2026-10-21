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

/** The sources a part reads; every source when the run is not split (null). */
export function sourcesOf(part: RunPart | null): RunSource[] {
  return part ? sourcesOfPace(part) : (Object.keys(SOURCE_PACE) as RunSource[]);
}

/** Whether a run of this kind is a split first look. */
export function splitsFirstLook(kind: string): boolean {
  return SPLIT_FIRST_LOOK && kind === "first";
}

/** "X", "X and Bluesky", "X, Bluesky and Reddit". */
export function sourceNames(sources: readonly RunSource[]): string {
  const names = sources.map((s) => SOURCE_NAME[s]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
