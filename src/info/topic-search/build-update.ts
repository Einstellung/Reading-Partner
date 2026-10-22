// A study's update, built (docs/info/91 更新): the next version of its one
// brief, added to the first look's file the way a retry adds (mergeRetry, part
// "update") and recorded in `study.versions`.
//
//   1. The pool is every candidate the study's runs read (the first look, its
//      retries and earlier updates, out of their run directories) with this
//      run's extra queries, the base version's items and the pinned ones always
//      in it. The rerank sees the topic as the reader's lines left it, those
//      lines (L1 …) and the labelled items as examples, and names the line
//      behind each score (`because`).
//   2. Pinned items come first and stay (select.ts selectStudy); a demoted one
//      goes to the Notes and stays; the rest by score, the Note line at
//      LABEL_BOUNDARY (update.ts placeOf).
//   3. An entry the base version had is kept as the file has it, unless a line
//      asks to rewrite it: then it is written again from its materials under a
//      new id. An item new to the brief is read (up to UPDATE_DEEP_READS papers
//      in full) and written. The overview is written for the whole version.
//
// No model judged the pool: nothing changes, the file records the unjudged
// candidates on the update's record, and the base version stays current. The
// write-up failed: the build throws and nothing is written, so the run fails
// and the base version stays current. A label file that cannot be read fails
// the build too: without it a pinned item could be dropped.

import { throwIfAborted } from "../../platform/app/abort";
import { MaterialRegistry, materialBodyPath, type MaterialBody } from "../dossier/registry";
import {
  deepReader,
  DRAFT_VIEW,
  draftOf,
  itemOfDraft,
  loadHistory,
  lookUpDraftRepos,
  lookUpPinned,
  MAX_MODEL_CALLS,
  rerankOfDraft,
  RESULT_ITEMS,
  SOURCE_HEALTH_FILE,
  sourceDepsOf,
  sourceHealth,
  type BuildResultDeps,
  type BuildTopicSearchResultArgs,
  type BuildTopicSearchResultOutput,
  type CarriedRead,
  type Draft,
} from "./build-result";
import { composeResult, studyReadOrder, type DeeperReport } from "./compose";
import { doiArxiv, heldDois, poolDois } from "./doi-arxiv";
import { latestLabels } from "./labels";
import { abortableSleep, retryingModel, topicCacheKey, type TopicModel } from "./model-io";
import { readsSource } from "./pace";
import { enqueue, labelQuestion, loadQueue, pickQuestions, questionCap, saveQueue, waiting, withLabelQuestion, type NewQuestion } from "./questions";
import { fusePool, gatherCandidates, numberPool, parseRerank, rankEvents, RERANK_POOL, rerankPrompt, scorePool, type ArxivFound, type RerankAnswer } from "./rank-pool";
import {
  highestNumber,
  mergeRetry,
  pendingJudging,
  TOPIC_SEARCH_RESULT_VERSION,
  type ResultStats,
  type StudyVersion,
  type TopicSearchResult,
  type TopicSearchResultItem,
} from "./result-types";
import { selectStudy } from "./select";
import { currentVersion, emptyStudyFile } from "./study";
import {
  changeCounts,
  diffVersion,
  labelExamples,
  placeOf,
  studyMarks,
  studyRuns,
  studyTarget,
  studyVersions,
  UPDATE_DEEP_READS,
  withHeld,
  type NextEntry,
} from "./update";
import { NOTHING_TO_JUDGE, RERANK_NAMED_NONE } from "./stage-failure";

/** Query ids an update's read held back for a rate limit or a cooldown, or never got to: left for the next update. */
export function skippedQueries(planned: readonly string[], arxiv: readonly ArxivFound[], huggingface: readonly ArxivFound[]): string[] {
  const held = (found: readonly ArxivFound[]) =>
    found.filter((f) => f.ladder?.outcome === "cooling_down" || f.ladder?.outcome === "rate_limited").map((f) => f.query);
  const ran = new Set([...arxiv, ...huggingface].map((f) => f.query));
  return [...new Set([...held(arxiv), ...held(huggingface), ...planned.filter((q) => !ran.has(q))])].filter((q) => planned.includes(q));
}

/** The line the rerank named for any member of a ranked event; null when it named none. */
function becauseOf(d: Draft): string | null {
  return d.members.map((m) => m.rerank?.because ?? null).find((b) => b !== null) ?? null;
}

export async function buildUpdate(deps: BuildResultDeps, args: BuildTopicSearchResultArgs): Promise<BuildTopicSearchResultOutput> {
  const { topic, since, runDir, signal } = args;
  const update = args.update!;
  const say = (text: string) => args.report?.(text);
  throwIfAborted(signal);
  const now = deps.now();
  let modelCalls = 0;
  // Every call of the topic carries its cache key (the write-up's retry resends its prompt).
  const retrying = retryingModel(deps.model, deps.sleep ?? abortableSleep);
  const model: TopicModel = (c) => retrying({ ...c, cacheKey: topicCacheKey(topic.id) });
  const call: TopicModel = async (c) => {
    modelCalls++;
    return model(c);
  };
  const callsLeft = () => MAX_MODEL_CALLS - modelCalls;

  const history = await loadHistory(deps, topic.id);
  const target = studyTarget(history);
  if (!target) throw new Error("the study has no brief to update");
  const [study, labels, profile, known, language, bookLanguage] = await Promise.all([
    deps.study ? deps.study(topic.id) : Promise.resolve(emptyStudyFile(topic.id)),
    deps.labels ? deps.labels(topic.id) : Promise.resolve([]),
    deps.profile(),
    deps.known ? deps.known() : Promise.resolve([]),
    deps.language(),
    deps.bookLanguage ? deps.bookLanguage() : deps.language(),
  ]);
  const versions = studyVersions(target, topic.seeds);
  const baseN = currentVersion(versions, study.rollbacks) ?? versions[versions.length - 1].n;
  const base = versions.find((v) => v.n === baseN)!;
  const version = Math.max(...versions.map((v) => v.n)) + 1;
  const confirmed = study.lines.filter((l) => l.state === "confirmed");
  const lines = confirmed.filter((l) => (update.lines ? update.lines.includes(l.id) : l.usedIn === null));
  const marks = studyMarks(labels, lines, confirmed.filter((l) => !lines.includes(l)));

  // 1. The pool: this run's reads and every earlier run's of the study.
  const carried: CarriedRead[] = [];
  for (const id of studyRuns(target)) {
    if (id === update.runId || !args.carry) continue;
    const got = await args.carry(id);
    if (got) carried.push(got);
  }
  const arxiv = args.arxiv;
  const huggingface = args.huggingface ?? [];
  const poolArxiv = [...arxiv, ...carried.flatMap((c) => c.arxiv)];
  const poolHf = [...huggingface, ...carried.flatMap((c) => c.huggingface)];
  const poolX = { ...args.x, posts: [...args.x.posts, ...carried.flatMap((c) => c.x?.posts ?? [])] };
  const gathered = gatherCandidates(topic, poolX, poolArxiv, since, poolHf);
  const own = gatherCandidates(topic, args.x, arxiv, since, huggingface);
  const byId = new Map(target.items.map((i) => [i.id, i]));
  // The base version's items, the pinned and the demoted are judged whatever the
  // fusion keeps; a pinned paper neither the reads nor the file hold (a seed the
  // first look could not look up) is looked up by its key.
  const held = new Set([
    ...base.entries.flatMap((e) => byId.get(e.item)?.keys ?? []),
    ...marks.pinned.keys(),
    ...marks.demoted.keys(),
  ]);
  const inFile = target.items.flatMap((i) => [i.key, ...i.keys]);
  const looked = await lookUpPinned(marks.pinned.keys(), new Set([...gathered.all.map((c) => c.key), ...inFile]), deps, since, signal);
  const numbered = numberPool(withHeld(fusePool(topic, gathered.kept, RERANK_POOL.first), [...gathered.all, ...looked], held));

  const name = `${target.id}.json`;
  const { queue: stored } = await loadQueue(deps.files, topic.id);
  const raisedBefore = stored.filter((q) => q.source === "model");
  const statsOf = (subtopicItems: Record<string, number>, reranked: boolean): ResultStats => ({
    candidates: {
      x: gathered.all.filter((c) => c.source === "x").length,
      arxiv: gathered.all.filter((c) => c.source === "arxiv").length,
      huggingface: gathered.all.filter((c) => c.source === "huggingface").length,
    },
    passedFloor: gathered.kept.length,
    pooled: numbered.length,
    reranked,
    avoidBlocked: {},
    subtopicItems,
    modelCalls,
  });
  const partOf = (over: Partial<TopicSearchResult> & { stats: ResultStats }): TopicSearchResult => ({
    version: TOPIC_SEARCH_RESULT_VERSION,
    id: target.id,
    searchId: topic.id,
    name: topic.name,
    kind: "first",
    date: deps.today(),
    createdAt: now,
    window: { since, until: now },
    empty: true,
    writeup: "none",
    overview: null,
    groups: [],
    quiet: [],
    items: [],
    materials: [],
    questions: [],
    runDir: target.runDir,
    ...over,
  });
  // The file, with the update's record (and its version when it made one), and the run's source health.
  const finish = async (part: TopicSearchResult, made: StudyVersion | null) => {
    throwIfAborted(signal);
    const merged = mergeRetry(target, part, update.runId, { part: "update", ...(made ? { version: made.n } : {}) });
    const written: TopicSearchResult = { ...merged, study: { versions: made ? [...versions, made] : versions } };
    await deps.files.write(name, `${JSON.stringify(written, null, 2)}\n`);
    const health = sourceHealth(topic, "first", args.x, arxiv, own.streams, [target], now, huggingface);
    // An update speaks only for the paper queries it searched.
    health.entries = health.entries.filter((e) => e.source !== "x" && update.queries.includes(e.query) && readsSource(topic, e.source));
    await deps.files.write(`${runDir.replace(/\/+$/, "")}/${SOURCE_HEALTH_FILE}`, `${JSON.stringify(health, null, 2)}\n`);
  };

  say(`re-judging ${numbered.length} candidates against ${lines.length} confirmed line${lines.length === 1 ? "" : "s"}`);
  let answers = new Map<string, RerankAnswer>();
  let unjudgedWhy: string | null = numbered.length ? null : NOTHING_TO_JUDGE;
  if (numbered.length) {
    const prompt = rerankPrompt(topic, numbered, profile, bookLanguage, raisedBefore.map((q) => q.text), {
      lines: lines.map((l) => ({ id: l.id, kind: l.kind, text: l.text })),
      examples: labelExamples(labels),
    });
    try {
      answers = parseRerank(await call({ site: "rerank", ...prompt, cache: false, signal }), numbered, topic, new Set(lines.map((l) => l.id)));
      if (answers.size === 0) unjudgedWhy = RERANK_NAMED_NONE;
    } catch (e) {
      if (signal.aborted) throw e;
      unjudgedWhy = e instanceof Error ? e.message : String(e);
    }
  }
  if (unjudgedWhy !== null) {
    await finish(partOf({ stats: statsOf({}, false), unjudged: { runId: update.runId, at: now, why: unjudgedWhy, candidates: numbered.length } }), null);
    return { resultFile: name, itemCount: 0, empty: true, unjudged: numbered.length, version: null };
  }

  // 2. What the version lists, and where.
  const dois = doiArxiv(heldDois([...poolArxiv, ...poolHf]), deps.arxivIdOfDoi ?? null);
  for (const doi of poolDois(numbered)) await dois.resolve(doi, signal);
  const scored = scorePool(topic, numbered, answers, dois.keyOfUrl);
  const drafts = rankEvents(scored).map(draftOf);
  const has = (map: ReadonlyMap<string, unknown>) => (d: Draft) => d.keys.some((k) => map.has(k));
  const isPinned = has(marks.pinned);
  const isDemoted = has(marks.demoted);
  const picked = topic.subtopics.filter((s) => s.picked).map((s) => s.id);
  // Pinned and demoted items both stay; only where they sit differs.
  const chosen = selectStudy(drafts, RESULT_ITEMS.first, picked, { ...DRAFT_VIEW, pinned: (d) => isPinned(d) || isDemoted(d) });
  const next: NextEntry[] = chosen.map((d) => ({
    key: d.cluster.lead.key,
    keys: d.keys,
    place: placeOf(d.score, isPinned(d), isDemoted(d) && !isPinned(d)),
    score: d.score,
    because: becauseOf(d),
  }));
  // A pinned or demoted item the pool no longer holds stays as the file has it.
  for (const [key, pinned] of [...[...marks.pinned.keys()].map((k) => [k, true] as const), ...[...marks.demoted.keys()].map((k) => [k, false] as const)]) {
    if (next.some((n) => n.key === key || n.keys.includes(key))) continue;
    const item = [...target.items].reverse().find((i) => i.key === key || i.keys.includes(key));
    if (item) next.push({ key: item.key, keys: item.keys, place: pinned ? "pinned" : "note", score: item.score, because: null });
  }
  const outBecause = new Map<string, string | null>();
  for (const d of drafts) if (!chosen.includes(d)) for (const k of d.keys) outBecause.set(k, becauseOf(d));
  const diff = diffVersion(base, target.items, next, marks, outBecause);

  // 3. Only what is new or asked to be rewritten is written.
  const registry = new MaterialRegistry(
    target.runDir,
    { write: (path, content) => deps.files.write(path, content) },
    highestNumber(target.materials.map((m) => m.id)),
  );
  const restore = async (item: TopicSearchResultItem) => {
    for (const id of item.materials) {
      const material = target.materials.find((m) => m.id === id);
      const raw = material ? await deps.files.read(materialBodyPath(target.runDir, id)) : null;
      if (!material || !raw) continue;
      try {
        registry.restore(material, JSON.parse(raw) as MaterialBody);
      } catch {
        // A body that cannot be read leaves the rewrite with the item's facts alone.
      }
    }
  };
  const sourceDeps = sourceDepsOf(deps, args.xPages, dois);
  const toRead = diff.entries
    .filter((e) => !e.keep && !e.from)
    .flatMap((e) => chosen.filter((c) => c.cluster.lead.key === e.key || c.keys.includes(e.key)).slice(0, 1));
  await lookUpDraftRepos(toRead, sourceDeps, dois.keyOfUrl, signal);
  const toWrite = diff.entries.filter((e) => !e.keep).length;
  say(`writing ${toWrite} new or rewritten entr${toWrite === 1 ? "y" : "ies"} of version ${version}`);
  let last = highestNumber(target.items.map((i) => i.id));
  const written: TopicSearchResultItem[] = [];
  const rewrite: { item: string; line: string }[] = [];
  const entryIds: (string | null)[] = [];
  const rerankOf = new Map<string, number>();
  for (const e of diff.entries) {
    throwIfAborted(signal);
    if (e.keep) {
      entryIds.push(e.keep);
      continue;
    }
    const id = `E${++last}`;
    if (e.from) {
      const old = byId.get(e.from)!;
      await restore(old);
      const { parts: _parts, ...rest } = old;
      written.push({ ...rest, id, summary: null, body: [], unknown: null });
      rewrite.push({ item: id, line: e.rewrite!.text });
      entryIds.push(id);
      continue;
    }
    const d = chosen.find((c) => c.cluster.lead.key === e.key || c.keys.includes(e.key));
    if (!d) {
      last--;
      entryIds.push(null);
      continue;
    }
    written.push(await itemOfDraft(d, id, { sourceDeps, registry, keyOfUrl: dois.keyOfUrl, call, callsLeft, language, signal }));
    const rerank = rerankOfDraft(d);
    if (rerank !== null) rerankOf.set(id, rerank);
    entryIds.push(id);
  }
  // Papers new to the brief are read in full first, as the first look's were.
  const fresh = written.filter((i) => !rewrite.some((r) => r.item === i.id));
  const deeper = deepReader(fresh, registry, sourceDeps, UPDATE_DEEP_READS);
  const upfront: DeeperReport = { read: [], failed: [], refused: [] };
  for (const id of studyReadOrder(fresh, registry, topic.seeds, rerankOf).slice(0, UPDATE_DEEP_READS)) {
    throwIfAborted(signal);
    const got = await deeper.read(id, signal);
    (got.ok ? upfront.read : upfront.failed).push(id);
  }
  const versionIds = entryIds.filter((id): id is string => id !== null);
  const writtenIds = new Set(written.map((i) => i.id));
  const shown = (id: string) => written.find((i) => i.id === id) ?? byId.get(id)!;
  const doubts: NewQuestion[] = scored
    .filter((s) => s.rerank?.doubt)
    .map((s) => ({ text: s.rerank!.doubt!, source: "model" as const, template: null, about: [s.cand.key] }));
  let queue = enqueue(stored, doubts, topic, now);
  const offered = waiting(queue).slice(0, 6);
  const label = new Map(offered.map((q, i) => [`Q${i + 1}`, q.id]));
  const composed = await composeResult(
    {
      topic,
      kind: "first",
      items: written,
      registry,
      profile,
      known,
      questions: offered.map((q, i) => ({ id: `Q${i + 1}`, text: q.text })),
      raised: raisedBefore.filter((q) => q.askedIn !== null).map((q) => q.text),
      language: bookLanguage,
      alongside: versionIds.filter((id) => !writtenIds.has(id)).map(shown),
      revision: { version, lines: lines.map((l) => ({ id: l.id, text: l.text })), rewrite },
    },
    model,
    signal,
    Math.max(0, callsLeft()),
  );
  modelCalls += composed.calls;
  if (!composed.written) throw new Error(`the write-up of version ${version} failed; version ${base.n} stays current`);
  for (const item of written) {
    const entry = composed.written.items.get(item.id);
    item.summary = entry?.summary ?? null;
    item.body = entry?.body ?? [];
    item.unknown = entry?.unknown ?? null;
    if (entry?.parts) item.parts = entry.parts;
  }
  const repeats = new Set([...composed.written.repeats].map((r) => label.get(r)).filter((r): r is string => !!r));
  const keyOf = new Map(written.map((i) => [i.id, i.key]));
  queue = enqueue(
    queue,
    composed.written.doubts.map((dq) => ({ text: dq.text, source: "model" as const, template: null, about: dq.item && keyOf.has(dq.item) ? [keyOf.get(dq.item)!] : [] })),
    topic,
    now,
  );
  const items = versionIds.map(shown);
  const labelAsk = labelQuestion(items, new Set(latestLabels(labels).keys()), queue, { version, criteria: topic.revision });
  const asked = withLabelQuestion(pickQuestions(queue, repeats, questionCap(history.length) - (labelAsk ? 1 : 0), target.id, now), labelAsk, target.id, now);

  const subtopicItems: Record<string, number> = {};
  for (const item of written) subtopicItems[item.subtopic ?? ""] = (subtopicItems[item.subtopic ?? ""] ?? 0) + 1;
  const stats = statsOf(subtopicItems, true);
  const reads = { read: [...upfront.read, ...composed.deeper.read], failed: [...upfront.failed, ...composed.deeper.failed], refused: composed.deeper.refused };
  if (reads.read.length + reads.failed.length) stats.deepReads = reads;
  const targetMaterials = new Set(target.materials.map((m) => m.id));
  const skipped = skippedQueries(update.queries, arxiv, huggingface);
  const made: StudyVersion = {
    n: version,
    at: now,
    runId: update.runId,
    base: base.n,
    entries: diff.entries.flatMap((e, i) => (entryIds[i] ? [{ item: entryIds[i]!, place: e.place, tag: e.tag }] : [])),
    removed: diff.removed,
    changes: diff.changes,
    lines: lines.map((l) => l.id),
    ...(skipped.length ? { skipped } : {}),
    overview: composed.written.overview,
  };
  const judged = pendingJudging(history).map((u) => u.runId);
  await finish(
    partOf({
      empty: written.length === 0,
      writeup: "model",
      overview: composed.written.overview,
      groups: [...new Set(written.map((i) => i.subtopic))].map((sub) => ({ subtopic: sub, items: written.filter((i) => i.subtopic === sub).map((i) => i.id) })),
      items: written,
      materials: registry.all.filter((m) => !targetMaterials.has(m.id) && written.some((i) => i.materials.includes(m.id))),
      questions: asked.asked.map((q) => ({ id: q.id, text: q.text, source: q.source, template: q.template })),
      stats,
      ...(judged.length ? { judged } : {}),
    }),
    made,
  );
  await saveQueue(deps.files, topic.id, asked.queue);
  // The lines are marked once the version they made is on file; a mark that fails leaves them for the next update too.
  if (lines.length && deps.useLines) await deps.useLines(topic.id, lines.map((l) => ({ ...l, usedIn: version }))).catch(() => undefined);
  return { resultFile: name, itemCount: made.entries.length, empty: made.entries.length === 0, version, changes: changeCounts(made.changes) };
}
