// Which shell the app mounts: the phone form factor (docs/22, info only) or the
// desktop/tablet one (App.tsx, the reader included). Decided from viewport width
// and pointer type, never from the operating system — an OS check would send an
// iPad into the phone shell and a browser window on a phone-sized desktop into
// the wrong one just as easily.
//
// Read once at mount and never re-evaluated: the two shells hold different
// state, so following a resize would mean remounting and throwing away whatever
// the reader was in the middle of.

export type Shell = "phone" | "desktop";

// The phone form factor lives below Tailwind's `sm` breakpoint, so the shell
// boundary and the styling boundary are the same number.
export const PHONE_MAX_WIDTH = 640;

export interface ShellEnv {
  // Viewport width in CSS pixels.
  width: number;
  // Viewport height in CSS pixels. The measurement is the shorter side, not the
  // width: a phone launched in landscape is 852 wide and would otherwise mount
  // the reader, and the choice is never revisited afterwards.
  height: number;
  // Whether the primary pointer is coarse (a finger). A narrow desktop window
  // still has a mouse, and the desktop shell is the right one for it.
  coarsePointer: boolean;
  // The ?shell= query parameter, or null when absent. Development happens on a
  // Linux desktop, where this override is the only way to see the phone shell.
  override: string | null;
}

export function pickShell(env: ShellEnv): Shell {
  if (env.override === "phone" || env.override === "desktop") return env.override;
  const shortSide = Math.min(env.width, env.height);
  return shortSide < PHONE_MAX_WIDTH && env.coarsePointer ? "phone" : "desktop";
}

// The environment as the running window reports it. matchMedia is absent in
// some test/embedded webviews; treating that as a fine pointer keeps the
// desktop shell, which is the one that can show everything.
export function readShellEnv(win: Window): ShellEnv {
  let override: string | null = null;
  try {
    override = new URLSearchParams(win.location.search).get("shell");
  } catch {
    // A location without a parseable search string: no override.
  }
  return {
    width: win.innerWidth,
    height: win.innerHeight,
    coarsePointer: win.matchMedia?.("(pointer: coarse)").matches ?? false,
    override,
  };
}

export function detectShell(win: Window): Shell {
  return pickShell(readShellEnv(win));
}
