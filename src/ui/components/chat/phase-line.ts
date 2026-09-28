// What the one status line says while a turn is running with nothing written
// yet. The line is drawn by PhaseLine (MessageList.tsx); the words are here so they can
// be read back by a test.

import type { TurnPhase } from "../../../ai/turn-view/turn-rows";
import { t } from "../../../i18n";

// `null` is "something else on the row already says this": a running tool draws
// its own trace line, and a reply arriving is its own evidence.
const PHASE_LABEL: Record<TurnPhase, (() => string) | null> = {
  thinking: () => t("chat.phase.thinking"),
  tool: null,
  writing: null,
};

// A streaming row with no phase yet is a turn whose first event has not
// arrived — the same nothing-yet as thinking, and the same line.
export function phaseLabel(phase: TurnPhase | undefined): string | null {
  const fn = phase ? PHASE_LABEL[phase] : PHASE_LABEL.thinking;
  return fn ? fn() : null;
}
