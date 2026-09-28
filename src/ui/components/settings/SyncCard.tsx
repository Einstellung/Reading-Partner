import { useEffect, useState } from "react";
import {
  setAutoSyncEnabled,
  signInToGoogle,
  signOutOfGoogle,
  subscribeSyncStatus,
  syncHealth,
  syncNow,
  type SyncStatus,
} from "../../../platform/sync";
import { formatDateTime, useT, type Translate } from "../../../i18n";
import { CARD } from "./cardStyles";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";

function formatSyncTime(ts: number | null, t: Translate): string {
  if (!ts) return t("settings.sync.never");
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("settings.sync.justNow");
  if (diff < 3_600_000) return t("settings.sync.minutesAgo", { count: Math.floor(diff / 60_000) });
  return formatDateTime(ts, { dateStyle: "medium", timeStyle: "short" });
}

// Google Drive sync (docs/13). Data and books live in the user's own Drive; no
// backend. Disabled with a hint until the Google client is configured via env.
export default function SyncCard() {
  const t = useT();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeSyncStatus(setStatus), []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // Tauri plugin invokes reject with plain strings; show them verbatim so
      // platform-level failures (network, scope, fs) are diagnosable in the UI.
      setError(e instanceof Error ? e.message : String(e) || t("settings.sync.failed"));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div className={CARD} />;

  // The one place that explains a stopped sync in full. The header dot and the
  // startup toast only point here.
  const report = syncHealth({ ...status, now: Date.now() });

  if (!status.configured) {
    return (
      <div className={CARD}>
        <span className="font-medium">{t("settings.sync.drive")}</span>
        <p className="m-0 text-sm text-faint-foreground">{t("settings.sync.notConfigured")}</p>
        <Button type="button" disabled>
          {t("settings.sync.signIn")}
        </Button>
      </div>
    );
  }

  if (!status.signedIn) {
    const broken = report.health === "credentials-missing";
    return (
      <div className={CARD}>
        <span className="font-medium">{t("settings.sync.drive")}</span>
        {broken ? (
          <p className="m-0 text-sm text-[#b45309]">
            {report.message} {t("settings.sync.signedOutNote")}
          </p>
        ) : (
          <p className="m-0 text-sm text-faint-foreground">
            {t("settings.sync.pitch")}
          </p>
        )}
        <Button type="button" disabled={busy} onClick={() => run(signInToGoogle)}>
          {busy ? t("settings.sync.completeInBrowser") : t("settings.sync.signIn")}
        </Button>
        {broken && (
          <span className="text-xs text-faint-foreground">
            {t("settings.sync.lastSync", { time: formatSyncTime(status.lastSyncAt, t) })}
          </span>
        )}
        {error && <p className="m-0 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{t("settings.sync.drive")}</span>
        <span className="text-xs text-[#5fb236]">{status.email ?? t("settings.connected")}</span>
      </div>
      <Label>
        <Checkbox
          checked={status.autoSync}
          disabled={busy}
          onCheckedChange={(v) => void run(() => setAutoSyncEnabled(v === true))}
        />
        {t("settings.sync.auto")}
      </Label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy || status.running}
          onClick={() => run(syncNow)}
        >
          {status.running ? t("settings.sync.running") : t("settings.sync.now")}
        </Button>
        {/* Quieter than Sync now beside it, the way sign-out is quieter than
            sign-in on a provider card. */}
        <Button type="button" variant="subtle" disabled={busy} onClick={() => run(signOutOfGoogle)}>
          {t("settings.signOut")}
        </Button>
        <span className="text-xs text-faint-foreground">
          {t("settings.sync.lastSync", { time: formatSyncTime(status.lastSyncAt, t) })}
        </span>
      </div>
      {report.message && (
        <p
          className={`m-0 text-xs ${report.alert === "alert" ? "text-[#b45309]" : "text-destructive"}`}
        >
          {report.message}
        </p>
      )}
      {error && <p className="m-0 text-xs text-destructive">{error}</p>}
    </div>
  );
}
