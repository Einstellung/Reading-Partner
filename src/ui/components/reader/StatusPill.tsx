// The one centred line at the bottom of the reader that a document being
// replaced gets while it runs and when it is over (TranslateStatus.tsx).
// Dismissable once the work has stopped.

import { useT } from "../../../i18n";

export default function StatusPill({
  text,
  running,
  onDismiss,
}: {
  text: string;
  running: boolean;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 text-sm text-card-foreground shadow-lg backdrop-blur">
        <span className="truncate">{text}</span>
        {!running && (
          <button
            type="button"
            className="shrink-0 text-muted-foreground can-hover:hover:text-foreground"
            onClick={onDismiss}
            aria-label={t("reader.status.dismiss")}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
