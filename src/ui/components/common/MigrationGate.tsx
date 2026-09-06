// The sheet the observation move puts in front of the app (migration-gate.ts
// holds every rule; this draws them).
//
// Both shells mount it and neither passes it anything: what it covers is the
// whole app, so there is nothing a shell knows about it that it does not know
// itself.
//
// Not a Radix dialog, and not portalled. Nothing here may be dismissed — no
// Escape, no press outside, no close control — and a dialog is a box you can be
// finished with. A plain fixed cover on the top rung of the scale is the shape
// that has no way out in it; <OverlayLayer /> is what stops the app's own
// press-outside floaters from reading a press on this as a press on them.

import { OVERLAY_SAFE, OVERLAY_Z, OverlayLayer } from "../ui/overlay";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import { useMigrationGate } from "./migration-gate";

export default function MigrationGate() {
  const { view, start } = useMigrationGate();
  if (!view.visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="migration-gate-title"
      className={cn("fixed inset-0 overflow-y-auto bg-background", OVERLAY_Z.blocking)}
    >
      <OverlayLayer />
      <div
        className={cn(
          OVERLAY_SAFE.fullscreen,
          "mx-auto flex min-h-full w-[min(34rem,100%)] flex-col justify-center gap-4",
        )}
      >
        <h1
          id="migration-gate-title"
          className="m-0 font-display text-[22px] font-semibold leading-tight text-foreground"
        >
          One-time update
        </h1>
        <p className="m-0 text-sm leading-normal text-muted-foreground">{view.message}</p>

        <div>
          <Button type="button" disabled={view.buttonDisabled} onClick={start}>
            {view.buttonLabel}
          </Button>
        </div>

        {view.incompleteNote && (
          <p className="m-0 text-xs text-faint-foreground">{view.incompleteNote}</p>
        )}
        {view.backupNote && <p className="m-0 text-xs text-faint-foreground">{view.backupNote}</p>}
        {view.error && <p className="m-0 text-xs text-[#b91c1c]">{view.error}</p>}
        {view.report && (
          <pre className="m-0 max-h-80 overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11px] leading-snug whitespace-pre text-muted-foreground">
            {view.report}
          </pre>
        )}
      </div>
    </div>
  );
}
