# Handoff: housekeeper confirm wiring (docs/platform/687 确认)

Branch `feat/housekeeper-confirm-wiring`, off origin/main 1d83548a.

## Done

- Soul turns: `raiseConfirmCard` passed into `assembleTurn` by the info chat (`use-info-call.ts` -> `assembleInfoTurn`), the door (`use-door-chat.ts` -> `prepareDoorTurn` -> `openDoorTurn`), the retell (`useRetell.ts` -> `buildRetellTurn`) and the coach (`useCoach.ts` -> `buildCoachTurn`). Card prefix `housekeeper`.
- Worker runs: `TurnDeliveryOutcome` "answered" carries `address` (thread file key + thread id), filled by `reading/turn/place-bell.ts` (door, briefing, meals) and `reading/turn/deliver.ts` (book). `soul/bell.ts` settle calls `soul/run-confirm-cards.ts appendRunConfirmCards(runId, address)` before the ack (injectable as `AnswerBellDeps.confirmCards`). Each pending record of the run becomes one ai message with a card part, id `housekeeper-<pendingId>`.
- `use-info-call.ts` listens to thread appends for housekeeper-confirm cards only (door and book views already listen to all appends).
- Tests: `tests/soul/edit-data-card.test.ts` (real assembleTurn + live write path, fake host gets the payload; no port -> refused), `tests/soul/run-confirm-cards.test.ts` (appender, bell asks before ack, no address -> nothing), `tests/ui/components/chat/housekeeper-confirm.test.ts` (stateAfterConfirm over real records: applied, declined -> gone, reclaimed -> gone, data moved -> stale, failed).
- 687 「确认」「挂在哪」 updated to match.

## Not done

- Step 2, headless screenshots of the card (open / applied / stale, phone and iPad widths). Plan: the project has no playwright package; `~/.cache/ms-playwright/chromium_headless_shell-1248` exists. Render `HousekeeperConfirmCard` per phase needs the phase injected (the hook reads the pending record via live deps): seed fake appData with a pending record or render a small harness page through vite dev server, served over http, shot with headless chromium. No visible windows.
- Reading chat (`reading/session/use-call.ts`), phone lesson and voice calls pass no port; a gated change there is refused. Reading chat has `shapes.current.cards` as a card channel and could take one.
- A program-delegated run gets no turn in bell.ts, so its pending records never get a card.
- No pitfall written (none found).
