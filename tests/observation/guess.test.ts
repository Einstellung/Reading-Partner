// The AI's guess section of the user profile (src/observation/guess.ts): the
// two-section format, the rules that decide what may be written, the gate that
// decides when the pass runs, and one pass end to end with a mocked AI turn
// (same harness as tests/observation/distill.test.ts — the real agent loop over a
// scripted stream, no provider, no credentials, no network). Run: bun test.

import { expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { runAgentLoop, type StreamFn } from "../../src/ai/agent";
import { createTurnSettler } from "../../src/ai/subagent/turn";
import type { SubagentTurnFn, SubagentTurnRequest } from "../../src/ai/subagent/types";
import type { FeedbackEvent } from "../../src/observation/feedback";
import {
  buildGuessSystemPrompt,
  buildGuessUserMessage,
  composeProfile,
  declaredText,
  guessPromptBlock,
  isGuessDue,
  normalizeGuesses,
  profileForPrompt,
  renderGuessLine,
  replaceDeclared,
  runProfileGuessPass,
  splitProfile,
  GUESS_BEGIN,
  GUESS_END,
  GUESS_MIN_GAP_MS,
  GUESS_SECTION_CHARS,
  GUESS_TOOL_NAME,
  MAX_GUESSES,
  PROFILE_CHARS,
  type ProfileGuess,
  type ProfileGuessInput,
  type RawGuess,
} from "../../src/observation/guess";

// --- the scripted turn (copied from distill.test.ts: one self-contained file) ---

type ToolReq = { name: string; args: Record<string, any>; id: string };
type Turn = { text?: string; calls?: ToolReq[] } | { error: string };

function turnEvents(turn: Turn): AssistantMessageEvent[] {
  if ("error" in turn) {
    const errMsg = fauxAssistantMessage("", { stopReason: "error", errorMessage: turn.error });
    return [{ type: "error", reason: "error", error: errMsg }];
  }
  const blocks = [
    ...(turn.text ? [fauxText(turn.text)] : []),
    ...(turn.calls ?? []).map((c) => fauxToolCall(c.name, c.args, { id: c.id })),
  ];
  const hasCalls = (turn.calls ?? []).length > 0;
  const message: AssistantMessage = fauxAssistantMessage(blocks.length ? blocks : "", {
    stopReason: hasCalls ? "toolUse" : "stop",
  });
  return [{ type: "done", reason: hasCalls ? "toolUse" : "stop", message }];
}

function loopRunner(turns: Turn[]) {
  const requests: SubagentTurnRequest[] = [];
  let round = 0;
  const stream: StreamFn = () => {
    const events = turnEvents(turns[round++] ?? { text: "done" });
    const s = createAssistantMessageEventStream();
    void (async () => {
      for (const ev of events) {
        await Promise.resolve();
        s.push(ev);
      }
      s.end();
    })();
    return s;
  };
  const run: SubagentTurnFn = (request) => {
    requests.push(request);
    const settler = createTurnSettler(request.signal, request.onRound);
    void runAgentLoop({
      stream,
      model: {} as Model<Api>,
      systemPrompt: request.systemPrompt,
      messages: [{ role: "user", content: request.task, timestamp: 0 }],
      tools: request.tools,
      signal: request.signal,
      maxRounds: request.maxRounds,
      purpose: request.purpose,
      ...settler.callbacks,
    });
    return settler.outcome.finally(() => settler.dispose());
  };
  return { run, requests };
}

const AUG_10 = Date.parse("2026-08-10T09:00:00Z");

function setCall(guesses: RawGuess[]): ToolReq {
  return { name: GUESS_TOOL_NAME, id: "c1", args: { guesses } };
}

// A profile store over a string, so a pass runs with no filesystem.
function makeProfile(initial: string) {
  const state = { text: initial, saves: 0 };
  return {
    state,
    store: {
      load: async () => state.text,
      save: async (text: string) => {
        state.text = text;
        state.saves++;
      },
    },
  };
}

const DECLARED = "Interests: robotics, macro.\nTaste: allergic to vendor PR.\n";

function guess(over: Partial<ProfileGuess> = {}): ProfileGuess {
  return {
    text: "Reads investment books for the era, not the method",
    basis: "Marked capital-flow passages in trends.pdf through 2026-08",
    since: "2026-08-01",
    ...over,
  };
}

// --- the two sections ---

test("a profile with no markers is entirely declared", () => {
  const split = splitProfile(DECLARED);
  expect(split).toEqual({ ok: true, before: DECLARED, after: "", guesses: [] });
  expect(declaredText(split)).toBe(DECLARED);
});

test("the guess section parses back into entries, declared untouched", () => {
  const file = composeProfile(splitProfile(DECLARED), [guess(), guess({ text: "Second", since: "2026-08-05" })]);
  const split = splitProfile(file);
  expect(split.ok).toBe(true);
  expect(split.before.startsWith(DECLARED)).toBe(true);
  expect(split.guesses).toHaveLength(2);
  expect(split.guesses[0]).toEqual(guess());
  expect(split.guesses[1].text).toBe("Second");
  expect(split.guesses[1].since).toBe("2026-08-05");
});

test("declared comes back byte for byte, and composing twice adds nothing", () => {
  const first = composeProfile(splitProfile(DECLARED), [guess()]);
  expect(first.startsWith(DECLARED)).toBe(true);
  // Writing the same set back is a fixed point — no whitespace accumulates, so a
  // pass that changes nothing is not a write.
  expect(composeProfile(splitProfile(first), [guess()])).toBe(first);
  // A second pass over the written file: a different guess set, the same declared
  // bytes, and no whitespace creeping in between them.
  const second = composeProfile(splitProfile(first), [guess({ text: "Revised" })]);
  expect(second.startsWith(DECLARED)).toBe(true);
  expect(second.slice(0, second.indexOf(GUESS_BEGIN))).toBe(
    first.slice(0, first.indexOf(GUESS_BEGIN)),
  );
  expect(second).toContain("Revised");
  expect(second).not.toContain("not the method");
  // Dropping every guess leaves the declared half and nothing else.
  const emptied = composeProfile(splitProfile(second), []);
  expect(emptied.trim()).toBe(DECLARED.trim());
  expect(emptied).not.toContain(GUESS_BEGIN);
});

test("text the user wrote below the section survives a rewrite", () => {
  const file = composeProfile(splitProfile(DECLARED), [guess()]) + "Now: reading trends.pdf (2026-08).\n";
  const split = splitProfile(file);
  expect(split.after).toContain("Now: reading trends.pdf (2026-08).\n");
  const rewritten = composeProfile(split, [guess({ text: "Revised" })]);
  expect(rewritten.startsWith(DECLARED)).toBe(true);
  expect(rewritten.endsWith("Now: reading trends.pdf (2026-08).\n")).toBe(true);
});

test("broken markers read as an all-declared profile that must not be written", () => {
  const noEnd = `${DECLARED}\n${GUESS_BEGIN}\n- x | basis: y | since: 2026-08-01\n`;
  expect(splitProfile(noEnd)).toEqual({ ok: false, before: noEnd, after: "", guesses: [] });

  const doubled = composeProfile(splitProfile(DECLARED), [guess()]) + GUESS_BEGIN + "\n";
  expect(splitProfile(doubled).ok).toBe(false);

  const reversed = `${GUESS_END}\nstuff\n${GUESS_BEGIN}\n`;
  expect(splitProfile(reversed).ok).toBe(false);
  // Nothing is parsed out of a file whose boundary is unknown: the whole thing is
  // the user's, which is what stops a splice from eating it.
  expect(declaredText(splitProfile(reversed))).toBe(reversed);
});

test("a mangled entry line is dropped, the section around it still parses", () => {
  const file = [
    DECLARED,
    GUESS_BEGIN,
    "## heading",
    "- no separators here at all",
    renderGuessLine(guess()),
    GUESS_END,
    "",
  ].join("\n");
  const split = splitProfile(file);
  expect(split.ok).toBe(true);
  expect(split.guesses).toEqual([guess()]);
});

// --- what may be written ---

const NORM = { today: "2026-08-10" };

test("an entry with no basis is dropped by the code, not just discouraged", () => {
  const kept = normalizeGuesses(
    [
      { guess: "He wants a read on the era", basis: "" },
      { guess: "", basis: "trends.pdf" },
      { guess: "He wants a read on the era", basis: "Marked capital flows on 2026-08-02" },
    ],
    NORM,
  );
  expect(kept).toHaveLength(1);
  expect(kept[0].basis).toContain("2026-08-02");
});

test("fields are collapsed and stripped of the separators the format reserves", () => {
  const [entry] = normalizeGuesses(
    [{ guess: "a | b\nc", basis: "from  trends.pdf | p12" }],
    NORM,
  );
  expect(entry.text).toBe("a / b c");
  expect(entry.basis).toBe("from trends.pdf / p12");
  // Which means the line it renders into round-trips.
  expect(splitProfile(composeProfile(splitProfile(""), [entry])).guesses).toEqual([entry]);
});

test("duplicates collapse and the set is capped", () => {
  const raw: RawGuess[] = Array.from({ length: 12 }, (_, i) => ({
    guess: `guess number ${i}`,
    basis: `basis ${i}`,
  }));
  raw.push({ guess: "GUESS NUMBER 0", basis: "same thing said twice" });
  const kept = normalizeGuesses(raw, NORM);
  expect(kept).toHaveLength(MAX_GUESSES);
  expect(kept.map((g) => g.text)).toEqual(raw.slice(0, MAX_GUESSES).map((g) => g.guess));
});

test("the tail is cut until the section fits its budget", () => {
  const raw: RawGuess[] = Array.from({ length: MAX_GUESSES }, (_, i) => ({
    guess: `${i} ${"long guess sentence ".repeat(5)}`,
    basis: "marked all through trends.pdf in 2026-08",
  }));
  const kept = normalizeGuesses(raw, NORM);
  expect(kept.length).toBeLessThan(MAX_GUESSES);
  expect(kept.map(renderGuessLine).join("\n").length).toBeLessThanOrEqual(GUESS_SECTION_CHARS);
  // Order is the model's: the cut falls on the end, not the front.
  expect(kept[0].text.startsWith("0 ")).toBe(true);
});

test("a long declared half squeezes the guesses, never the other way round", () => {
  const raw: RawGuess[] = Array.from({ length: 4 }, (_, i) => ({
    guess: `guess ${i} ${"x".repeat(60)}`,
    basis: "trends.pdf, 2026-08",
  }));
  const roomy = normalizeGuesses(raw, NORM);
  const squeezed = normalizeGuesses(raw, { ...NORM, declaredChars: PROFILE_CHARS - 200 });
  expect(squeezed.length).toBeLessThan(roomy.length);
  expect(squeezed.map(renderGuessLine).join("\n").length).toBeLessThanOrEqual(200);
});

test("an unchanged guess keeps the date it first appeared", () => {
  const previous = [guess({ since: "2026-07-01" })];
  const [kept] = normalizeGuesses(
    // The model restamped it with today; the code does not believe it.
    [{ guess: previous[0].text, basis: previous[0].basis, since: "2026-08-10" }],
    { ...NORM, previous },
  );
  expect(kept.since).toBe("2026-07-01");
});

test("a new guess takes today unless it names a real earlier date", () => {
  const kept = normalizeGuesses(
    [
      { guess: "new one", basis: "b" },
      { guess: "backdated", basis: "b", since: "2026-07-04" },
      { guess: "future", basis: "b", since: "2027-01-01" },
      { guess: "nonsense", basis: "b", since: "last week" },
    ],
    NORM,
  );
  expect(kept.map((g) => g.since)).toEqual(["2026-08-10", "2026-07-04", "2026-08-10", "2026-08-10"]);
});

// --- when it runs ---

const NEVER = { lastRunAt: null, lastMemoryAt: null };

test("the gate needs memory, a gap, and memory that has actually moved", () => {
  // Nothing distilled yet: nothing to guess from.
  expect(isGuessDue(NEVER, null, AUG_10)).toBe(false);
  // Never run, and there is memory: the first pass is the one this exists for.
  expect(isGuessDue(NEVER, AUG_10 - 1000, AUG_10)).toBe(true);

  const ran = { lastRunAt: AUG_10 - GUESS_MIN_GAP_MS / 2, lastMemoryAt: AUG_10 - GUESS_MIN_GAP_MS };
  // Inside the gap, however much has been distilled since.
  expect(isGuessDue(ran, AUG_10, AUG_10)).toBe(false);

  const old = { lastRunAt: AUG_10 - GUESS_MIN_GAP_MS * 2, lastMemoryAt: AUG_10 - GUESS_MIN_GAP_MS * 2 };
  // Past the gap but the memory has not moved since: the same evidence would
  // produce the same guesses.
  expect(isGuessDue(old, old.lastMemoryAt, AUG_10)).toBe(false);
  expect(isGuessDue(old, old.lastMemoryAt! + 1, AUG_10)).toBe(true);
});

// --- one pass ---

const EVIDENCE = {
  topics: [
    {
      topicName: "investing",
      entries: [
        {
          type: "reading-position" as const,
          summary: "Reached chapter 6 of trends.pdf",
          updated: "2026-08-09",
          id: "m-11111111",
        },
        {
          type: "belief" as const,
          summary: "Thinks the capital rotation is already priced in",
          updated: "2026-08-08",
          id: "m-22222222",
        },
      ],
    },
  ],
  feedback: [
    { ts: 1, itemId: "i1", title: "Chip capex hits a record", action: "opened" as const },
    { ts: 2, itemId: "i2", title: "Ten prompts for founders", action: "dismissed" as const, category: "listicle" },
  ] satisfies FeedbackEvent[],
};

test("a pass writes only the guess section, leaving declared byte for byte", async () => {
  const { state, store } = makeProfile(DECLARED);
  const runner = loopRunner([
    {
      calls: [
        setCall([
          {
            guess: "Wants a read on the period, not stock-picking technique",
            basis: "Every mark in trends.pdf is on capital flows, through 2026-08",
          },
        ]),
      ],
    },
    { text: "done" },
  ]);

  const result = await runProfileGuessPass(EVIDENCE, {
    profile: store,
    run: runner.run,
    now: () => AUG_10,
  });

  expect(result).toEqual({
    ran: true,
    ok: true,
    outcome: "answered",
    wrote: true,
    guesses: 1,
    dropped: 0,
  });
  expect(state.text.startsWith(DECLARED)).toBe(true);
  const split = splitProfile(state.text);
  expect(split.guesses).toHaveLength(1);
  expect(split.guesses[0].since).toBe("2026-08-10");
  // Every declared byte is still there, in order, with nothing but the blank line
  // before the section added.
  expect(declaredText(split).startsWith(DECLARED)).toBe(true);
  expect(declaredText(split).trim()).toBe(DECLARED.trim());
});

test("the new set replaces the old one, overturned guesses and all", async () => {
  const before = composeProfile(splitProfile(DECLARED), [
    guess({ text: "Old and wrong", since: "2026-07-01" }),
    guess({ text: "Still true", since: "2026-07-02" }),
  ]);
  const { state, store } = makeProfile(before);
  const runner = loopRunner([
    {
      calls: [
        setCall([
          { guess: "Still true", basis: guess().basis },
          { guess: "Newly noticed", basis: "Opened three capex pieces in 2026-08" },
        ]),
      ],
    },
    { text: "done" },
  ]);

  const result = await runProfileGuessPass(EVIDENCE, { profile: store, run: runner.run, now: () => AUG_10 });
  expect(result).toMatchObject({ ran: true, ok: true, wrote: true, guesses: 2 });
  const split = splitProfile(state.text);
  expect(split.guesses.map((g) => g.text)).toEqual(["Still true", "Newly noticed"]);
  // The survivor kept its own first-seen date; the new one is dated today.
  expect(split.guesses[0].since).toBe("2026-07-02");
  expect(split.guesses[1].since).toBe("2026-08-10");
  expect(state.text.startsWith(DECLARED)).toBe(true);
});

test("entries the rules reject never reach the file, and are counted", async () => {
  const { state, store } = makeProfile(DECLARED);
  const runner = loopRunner([
    {
      calls: [
        setCall([
          { guess: "Has a basis", basis: "trends.pdf, 2026-08" },
          { guess: "Sounds good, stands on nothing", basis: "   " },
        ]),
      ],
    },
    { text: "done" },
  ]);

  const result = await runProfileGuessPass(EVIDENCE, { profile: store, run: runner.run, now: () => AUG_10 });
  expect(result).toMatchObject({ ran: true, ok: true, wrote: true, guesses: 1, dropped: 1 });
  expect(state.text).not.toContain("stands on nothing");
});

test("an unparseable profile is never written, and never reaches the model", async () => {
  const broken = `${DECLARED}\n${GUESS_BEGIN}\n- x | basis: y | since: 2026-08-01\n`;
  const { state, store } = makeProfile(broken);
  const runner = loopRunner([{ calls: [setCall([{ guess: "g", basis: "b" }])] }, { text: "done" }]);

  const result = await runProfileGuessPass(EVIDENCE, { profile: store, run: runner.run, now: () => AUG_10 });
  expect(result).toEqual({ ran: false, skipped: "unparseable-profile" });
  expect(runner.requests).toHaveLength(0);
  expect(state.text).toBe(broken);
  expect(state.saves).toBe(0);
});

test("a pass with nothing to read never reaches the model", async () => {
  const { store } = makeProfile(DECLARED);
  const runner = loopRunner([{ text: "done" }]);
  const result = await runProfileGuessPass(
    { topics: [{ topicName: "empty", entries: [] }], feedback: [] },
    { profile: store, run: runner.run, now: () => AUG_10 },
  );
  expect(result).toEqual({ ran: false, skipped: "no-evidence" });
  expect(runner.requests).toHaveLength(0);
});

test("a pass that calls nothing leaves the file alone", async () => {
  const before = composeProfile(splitProfile(DECLARED), [guess()]);
  const { state, store } = makeProfile(before);
  const result = await runProfileGuessPass(EVIDENCE, {
    profile: store,
    run: loopRunner([{ text: "done" }]).run,
    now: () => AUG_10,
  });
  expect(result).toMatchObject({ ran: true, ok: true, wrote: false, guesses: 1 });
  expect(state.saves).toBe(0);
  expect(state.text).toBe(before);
});

test("a set identical to the one on file is not a write", async () => {
  const before = composeProfile(splitProfile(DECLARED), [guess()]);
  const { state, store } = makeProfile(before);
  const result = await runProfileGuessPass(EVIDENCE, {
    profile: store,
    run: loopRunner([
      { calls: [setCall([{ guess: guess().text, basis: guess().basis, since: guess().since }])] },
      { text: "done" },
    ]).run,
    now: () => AUG_10,
  });
  expect(result).toMatchObject({ ran: true, ok: true, wrote: false });
  expect(state.saves).toBe(0);
});

test("a call that failed is a failed pass, and the profile is untouched", async () => {
  const before = composeProfile(splitProfile(DECLARED), [guess()]);
  const { state, store } = makeProfile(before);
  const result = await runProfileGuessPass(EVIDENCE, {
    profile: store,
    run: loopRunner([{ calls: [setCall([{ guess: "new", basis: "b" }])] }, { error: "connection reset" }]).run,
    now: () => AUG_10,
  });

  expect(result).toMatchObject({ ran: true, ok: false, outcome: "failed", wrote: false });
  // The tool captured the entries, but a pass that did not finish does not write:
  // the caller leaves its stamp alone and the next sweep redoes the whole thing.
  expect(state.saves).toBe(0);
  expect(state.text).toBe(before);
});

// --- the prompts ---

function promptInput(over: Partial<ProfileGuessInput> = {}): ProfileGuessInput {
  return {
    declared: DECLARED,
    guesses: [guess()],
    topics: EVIDENCE.topics,
    feedback: EVIDENCE.feedback,
    today: "2026-08-10",
    ...over,
  };
}

test("the prompt asks for the whole set and presses for overturning", () => {
  const prompt = buildGuessSystemPrompt(promptInput());
  expect(prompt).toContain("NEW WHOLE SET");
  expect(prompt).toContain("DROP the ones the evidence no longer supports");
  expect(prompt).toContain("A set that only");
  expect(prompt).toContain("Do NOT guess how good they are");
  expect(prompt).toContain("today is 2026-08-10");
  expect(prompt).toContain(`${MAX_GUESSES} entries`);
});

test("the user message carries the declared half, the current set and both signals", () => {
  const msg = buildGuessUserMessage(promptInput());
  expect(msg).toContain("Interests: robotics, macro.");
  expect(msg).toContain(renderGuessLine(guess()));
  expect(msg).toContain('Topic "investing"');
  expect(msg).toContain("Reached chapter 6 of trends.pdf");
  expect(msg).toContain('opened: "Chip capex hits a record"');
  expect(msg).toContain('dismissed: "Ten prompts for founders" [listicle]');
});

// --- reading it back out ---

test("profileForPrompt hands the two halves out separately", () => {
  const file = composeProfile(splitProfile(DECLARED), [guess()]);
  const { declared, guesses } = profileForPrompt(file);
  expect(declared).toBe(DECLARED.trim());
  expect(guesses).toBe(guessPromptBlock([guess()]));
  // Nothing of the marker machinery reaches a prompt.
  expect(declared).not.toContain(GUESS_BEGIN);
  expect(guesses).not.toContain(GUESS_END);

  // A file whose markers do not parse is all declared, and no guess is injected
  // as if it had been confirmed.
  const broken = `${DECLARED}${GUESS_BEGIN}\n- x | basis: y | since: 2026-08-01\n`;
  expect(profileForPrompt(broken).guesses).toBe("");
  expect(profileForPrompt(broken).declared).toBe(broken.trim());
});

test("applying a declared rewrite keeps the guesses standing", () => {
  const file = composeProfile(splitProfile(DECLARED), [guess()]);
  const next = replaceDeclared(file, "Interests: robotics only now.\n");
  expect(next.startsWith("Interests: robotics only now.\n")).toBe(true);
  expect(splitProfile(next).guesses).toEqual([guess()]);
  expect(next).not.toContain("macro");
});
