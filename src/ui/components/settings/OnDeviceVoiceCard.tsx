import { useEffect, useRef, useState } from "react";
import { kokoroBridge } from "../../../ai/voice";
import type { KokoroBridge, KokoroStatus } from "../../../ai/voice/kokoro";
import { useT } from "../../../i18n";
import { Button } from "../ui/button";
import { CARD } from "./cardStyles";
import { createVoicePoller, isCallVoice, voiceRowView, type VoicePoller } from "./on-device-voice";

// The voice output card on iOS: the on-device voice's one-time download
// (on-device-voice.ts holds the states and the polling).
export default function OnDeviceVoiceCard({ bridge = kokoroBridge }: { bridge?: KokoroBridge }) {
  const t = useT();
  const [status, setStatus] = useState<KokoroStatus | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const poller = useRef<VoicePoller | null>(null);

  useEffect(() => {
    const p = createVoicePoller(bridge, setStatus, setStartError);
    poller.current = p;
    p.kick();
    return () => p.stop();
  }, [bridge]);

  const download = async () => {
    setStartError(null);
    setStarting(true);
    await poller.current?.start();
    setStarting(false);
  };

  const view = voiceRowView(status, { startError, starting });
  const call = isCallVoice();

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{t("settings.optional.onDeviceVoice")}</span>
        {view.kind === "idle" && (
          <Button type="button" variant="outline" onClick={download}>
            {view.resumable
              ? t("settings.optional.onDeviceVoiceResume", { percent: view.percent })
              : t("settings.optional.onDeviceVoiceDownload")}
          </Button>
        )}
        {view.kind === "starting" && (
          <Button type="button" variant="outline" disabled>
            {t("settings.optional.onDeviceVoiceStarting")}
          </Button>
        )}
        {view.kind === "failed" && (
          <Button type="button" variant="outline" onClick={download}>
            {t("settings.optional.onDeviceVoiceRetry")}
          </Button>
        )}
        {view.kind === "ready" && (
          <span className="text-xs text-muted-foreground">
            {t("settings.optional.onDeviceVoiceReady")}
          </span>
        )}
        {view.kind === "downloading" && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("settings.optional.onDeviceVoiceProgress", {
              percent: view.percent,
              have: view.haveMB,
              total: view.totalMB,
            })}
          </span>
        )}
      </div>

      {view.kind === "downloading" && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${view.percent}%` }} />
        </div>
      )}

      <p className="m-0 text-xs text-faint-foreground">
        {view.kind === "ready"
          ? t(call ? "settings.optional.onDeviceVoiceCallHint" : "settings.optional.onDeviceVoiceHint")
          : t(call ? "settings.optional.onDeviceVoiceCallSize" : "settings.optional.onDeviceVoiceSize", {
              mb: view.totalMB,
            })}
      </p>

      {view.kind === "failed" && (
        <p className="m-0 text-xs text-destructive">
          {t("settings.optional.onDeviceVoiceFailed", { percent: view.percent })}
          <span className="block break-words text-faint-foreground">{view.error}</span>
        </p>
      )}
    </div>
  );
}
