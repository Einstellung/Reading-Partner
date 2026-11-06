# Handoff: pi 1.1.0 -> 1.5.0 (branch chore/pi-1.5)

## Done (commit "Upgrade pi packages to 1.5.0", WIP)

- package.json: chord, pi-ai, pi-codemode, pi-durable pinned 1.5.0 (pi-codemode was 1.4.0). bun.lock updated.
  Tree now has pi-schema 1.5.0 and pi-telemetry 1.5.0 (all MIT; pi-schema vendors TypeBox code, MIT, LICENSES/typebox-LICENSE). pi-agent-core is not in the tree.
- pi-ai no longer exports `Type`/`TSchema` (typebox dropped for pi-schema). Added `typebox@1.3.27` (exact, the version pi used before, MIT) as a direct dependency and moved the 61 `Type`/`TSchema` imports to `"typebox"`. Schemas are byte-identical to before; pi 1.5 accepts TypeBox schemas and types their args.
- `SqliteExecutor.runCounted` (new required): Rust command `durable_sqlite_run_counted` (src-tauri/src/durable_sqlite.rs, registered in both handler lists in lib.rs; `cargo check --lib` passes), facade method in src/platform/app/durable-sqlite.ts, bun stand-in in tests/platform/app/durable-sqlite-host.ts.
- `defineDoc` needs `checkpointWhen` since 1.4.0: added `checkpointWhen: () => false` to the six docs (extension.ts, child.ts).
- `Conversation.viewState()` removed: new src/legion/durable/follow-view.ts (`followActiveView`, `activeEntries`) watches with `{ from: first active entry, max: 10000 }` and projects the window back to the active transcript (newest head marker + entries from its head), because 1.5 views are windows over the fork-aware history with reset markers in place. Used by reading/turn/durable-turn.ts and legion/durable/background.ts. Tests use tests/legion/durable/support/view-state.ts (a viewState shim on it).
- Tests: `content` -> `output` in test tools, `Storage.commit(batches, receive, context)` wrapper in sqlite-scenes.
- harness.ts: `progress.persistWithinMs: 0` so partials are stored with each partial commit as in 1.1.0 (1.5 defers them up to 1 s; the half-sentence recovery depends on stored partials). Same in sqlite-scenes settings.

`bun run typecheck`: clean. `scripts/t.sh`: 9230 pass / 16 fail before the persistWithinMs change.

## Still failing (16)

1. Kill/crash tests (door-kill, info-kill x2, durable/crash, reading/turn durable-kill, one-thread-kill x2): `recovered` outcome is "nothing" instead of "mid-text". Leading hypothesis, not yet probed: 1.5 "a generation whose model request was in flight when the host died no longer resends it on open: the attempt counts as failed under settings.retry; its partial becomes an aborted entry". harness.ts has `retry: { enabled: false }`, so `Harness.open` itself may convert `pi.live.generation.message` into an aborted entry before `recoverBeforeResume` (src/legion/durable/recover.ts) reads it, leaving `run` but no half. Check by opening the killed child's turns-*.sqlite and reading pi.live + the last entries. If so, recover.ts should read the half sentence from that aborted assistant entry (or open readOnly first) instead of `live.generation.message`.
2. sqlite-scenes "stream killed mid-reply": stored partial is 196 chars when the view showed 200. In 1.5 watches see a commit before Storage has it, so a kill armed on the view can beat the store by one partial. Assertion `>= 200` needs to accept that (pitfall 694 material).
3. Not yet looked at: subagent-durable x2, watchdog "context overflow is taken out before pi's classifier", background.test "a run calls its own tools...", runtime.test "a steer during a tool round...", reading/turn/turn.test x2 ("narrowest window", "reading ladder" — maybe tool schema token estimate changed), prep/background-durable. Re-run `scripts/t.sh <file>` for each.

## Not started

- `bun run wasm` (pi-codemode 1.5 quickjs.wasm path; scripts/copy-quickjs-wasm.sh).
- SQLite store format: 1.4.0 changelog says opening a SQLite storage migrates it to schema version 2 automatically (rebuilds the task table), not reversible by 1.3.0 or earlier. Also `pi.live` v3, `pi.tool` v3, `pi.generation` v2 have migrations for stored older values. The app's generation swap is in harness.ts (`turns-<code>.sqlite`, highest code opened). Needs a unit test opening a 1.1.0-written db (write one with pi-durable 1.1.0 in a scratch dir, `npm pack`) and running a turn to the end.
- Default model for OpenAI tiers (src/ai/providers.ts, docs/soul/75), smoke test with gpt-6.1-terra, pitfall review, pitfall 694.
- Full breaking-change list: node_modules/@earendil-works/pi-durable/CHANGELOG.md 1.2.0-1.5.0 and chord/CHANGELOG.md. pi-ai has no CHANGELOG in the package.
