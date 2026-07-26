import { useEffect, useState } from "react";
import { BTN, BTN_PRIMARY } from "../common/buttons";
import {
  setAutoSyncEnabled,
  signInToGoogle,
  signOutOfGoogle,
  subscribeSyncStatus,
  syncHealth,
  syncNow,
  type SyncStatus,
} from "../../../platform/sync";
import { CARD } from "./cardStyles";

function formatSyncTime(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  return new Date(ts).toLocaleString();
}

// Google Drive sync (docs/13). Data and books live in the user's own Drive; no
// backend. Disabled with a hint until the Google client is configured via env.
export default function SyncCard() {
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
      setError(e instanceof Error ? e.message : String(e) || "Sync action failed");
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
        <span className="font-medium">Google Drive</span>
        <p className="m-0 text-sm text-[#777]">Google client not configured.</p>
        <button type="button" className={BTN_PRIMARY} disabled>
          Sign in with Google
        </button>
      </div>
    );
  }

  if (!status.signedIn) {
    const broken = report.health === "credentials-missing";
    return (
      <div className={CARD}>
        <span className="font-medium">Google Drive</span>
        {broken ? (
          <p className="m-0 text-sm text-[#b45309]">
            {report.message} Everything since the last sync is on this device only. Sign in again
            to resume; nothing local is lost.
          </p>
        ) : (
          <p className="m-0 text-sm text-[#777]">
            Sync reading progress, marks, and books to your own Google Drive.
          </p>
        )}
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={busy}
          onClick={() => run(signInToGoogle)}
        >
          {busy ? "Complete sign-in in your browser…" : "Sign in with Google"}
        </button>
        {broken && (
          <span className="text-xs text-[#777]">Last sync: {formatSyncTime(status.lastSyncAt)}</span>
        )}
        {error && <p className="m-0 text-xs text-[#b91c1c]">{error}</p>}
      </div>
    );
  }

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">Google Drive</span>
        <span className="text-xs text-[#5fb236]">{status.email ?? "Connected"}</span>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={status.autoSync}
          disabled={busy}
          onChange={(e) => void run(() => setAutoSyncEnabled(e.target.checked))}
        />
        Sync automatically
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BTN}
          disabled={busy || status.running}
          onClick={() => run(syncNow)}
        >
          {status.running ? "Syncing…" : "Sync now"}
        </button>
        <button type="button" className={BTN} disabled={busy} onClick={() => run(signOutOfGoogle)}>
          Sign out
        </button>
        <span className="text-xs text-[#777]">Last sync: {formatSyncTime(status.lastSyncAt)}</span>
      </div>
      {report.message && (
        <p
          className={`m-0 text-xs ${report.alert === "alert" ? "text-[#b45309]" : "text-[#b91c1c]"}`}
        >
          {report.message}
        </p>
      )}
      {error && <p className="m-0 text-xs text-[#b91c1c]">{error}</p>}
    </div>
  );
}
