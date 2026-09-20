// The two taps the hand feels, for the one gesture that has no other
// confirmation on a phone: a hold on Lumen opening the voice session, and a
// hold ending it (docs/68).
//
// One medium impact to start, two light ones to end. Two directions that must
// not feel alike, and the pair reads as a hang-up the way a double click reads
// as one thing rather than two.
//
// Everywhere else this does nothing and says nothing. The plugin exists only on
// iOS and Android (its Rust half is registered for mobile alone), the iPad has
// no vibration motor at all whatever the API says, and on the desktop the
// invoke throws before it reaches a host. So every call is caught, and the
// light the body charges with is the confirmation on every device — the haptic
// is only added where there is a motor.

import { impactFeedback } from "@tauri-apps/plugin-haptics";

/** The gap between the two taps that end a session. */
export const STOP_GAP_MS = 120;

/** A session opened. */
export async function voiceStartFeedback(): Promise<void> {
  await impact("medium");
}

/** A session ended. */
export async function voiceStopFeedback(): Promise<void> {
  // The second tap is skipped where the first did nothing: a host with no motor
  // would otherwise sit through the gap for a vibration nobody can feel.
  if (!(await impact("light"))) return;
  await wait(STOP_GAP_MS);
  await impact("light");
}

/** Whether the host actually felt it. */
async function impact(style: "light" | "medium"): Promise<boolean> {
  try {
    const result = await impactFeedback(style);
    return result.status === "ok";
  } catch {
    return false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
