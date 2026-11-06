# Handoff: housekeeper write core (docs/platform/687)

Branch `feat/housekeeper-write`, off origin/main aca3d9b5.

## Done

- `src/palace/kinds.ts`: `PalaceRow.ai?: { write?: true }`; two rows `housekeeper-version` (`housekeeper-versions/<kind>/<writeId>.json`, data, opaque, keep-last 20 by name, `dir` depth 2) and `housekeeper-pending` (`housekeeper-pending/p-*.json`, data, opaque, age 7 days mtime). No existing row is marked.
- `src/housekeeper/generic.ts`: keep-last/age/tail also list the subdirectories of a row whose `dir` is depth 2 with no `nested`, so every kind directory under `housekeeper-versions/` is kept to 20.
- `src/housekeeper/write/`: `registry.ts` (entry type, `registerWritable`, `editableRows`, `dataPath`, `writeGuardProblems`), `paths.ts` (leaf diff, `*` patterns), `store.ts` (io, `textBase`, versions, pending, `pendingOfRun`), `engine.ts` (`settleEdit`, `confirmPending`, `declinePending`, `undoLatest`), `tool.ts` (`edit_data`, `undo_edit`, `withEditData`), `card.ts` (payload `housekeeper-confirm`).
- `legion/codemode` exports `sandboxTool` so edit_data reuses run_code's per-tool wrapper, runner, wasm and limits.
- Mounted after `withCodemode` in `soul/turn.ts` (`AssembleInput.raiseConfirmCard`, initiator from `env.thread.id` + origin place) and `legion/subagent/run.ts` (`SubagentRequest.edit`; `agentWorker` passes the run id). Mounted only when some entry is registered (none yet). Catalog registers `buildEditTools([], …)`.
- `soul/catalogue.ts` appends "Can be changed with edit_data." for marked and registered kinds.
- Card: `ui/components/chat/HousekeeperConfirmCard.tsx` + `housekeeper-confirm.ts` (the card calls the housekeeper itself, not the host's onCardAction); in the `CardPayload` union and `CARD_REGISTRY`. i18n keys under `chat.editData.*`, `chat.undoEdit.*`, `chat.housekeeperConfirm.*`, 9 languages.
- Layering: `housekeeper/write` registered as capability.
- Tests: `tests/housekeeper/write.test.ts`, `write-guard.test.ts`, `write-fixture.ts`.
- Pitfall 688 (undo through land does not restore bytes; undo checks the version chain).
- 687 updated where the code differs.

## Not done

- No host passes `raiseConfirmCard` yet, so a gated change in a soul turn comes back "no card can be shown here". The meals chat host is `ui/components/info/use-info-call.ts` (`raiseCard("housekeeper", payload)`), reached through `info/briefer/info-turn.ts` `assembleInfoTurn` → `assembleTurn`; add a `raiseConfirmCard` passthrough there. The door (`soul/door.ts`, `use-door-chat.ts`) likewise.
- A worker's pending records are stored with `initiator.runId`, but nothing raises their cards on delivery. `TurnDeliveryOutcome` (soul/delivery.ts) does not carry the thread key; each place's `TurnDeliverer` would have to call `pendingOfRun(runId)` and append card messages to the thread it answered in.
- `stateAfterConfirm` has no unit test; the card has not been looked at rendered.
