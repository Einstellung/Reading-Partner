import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type DeviceCodeState, type ProviderInfo } from "../../../ai";
import { useT } from "../../../i18n";
import { isIOS } from "../../../platform/app/platform";
import { CARD } from "./cardStyles";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

// The inline "or do it the other way" links under the sign-in button.
const LINK = "self-start text-xs text-accent-line hover:underline";

// The loopback-free login path for a provider. Anthropic pastes the code the
// authorize page prints; OpenAI runs the ChatGPT device-code flow (with a
// paste-the-URL fallback when the account has device sign-in disabled). Both
// end by exchanging a code through the card's `loginWithManualCode`.
type CodeFlow =
  | { kind: "paste"; manualStart: () => Promise<void> }
  | {
      kind: "device";
      runDeviceCode: (o: {
        onState: (s: DeviceCodeState) => void;
        signal?: AbortSignal;
      }) => Promise<void>;
      manualStart: () => Promise<void>;
    };

// Subscription-OAuth provider card (Anthropic Claude, OpenAI ChatGPT). Desktop
// keeps the loopback-capture flow as the primary button with a "Sign in with a
// code" secondary entry (also handy as a desktop test/fallback route). On iOS
// there is no loopback listener, so the code flow is promoted to the primary
// button and loopback is hidden. The code flow itself is per-provider (paste vs
// device code), supplied via `codeFlow`.
export default function OAuthCard({
  name,
  signInLabel,
  provider,
  login,
  loginWithManualCode,
  logout,
  codeFlow,
  onChanged,
  onActivated,
}: {
  name: string;
  signInLabel: string;
  provider?: ProviderInfo;
  login: () => Promise<void>;
  loginWithManualCode: (input: string) => Promise<void>;
  logout: () => Promise<void>;
  codeFlow: CodeFlow;
  onChanged: () => void;
  onActivated: () => void;
}) {
  const t = useT();
  const ios = isIOS();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // idle: entry buttons; paste: show the code input; device: OpenAI device flow.
  const [mode, setMode] = useState<"idle" | "paste" | "device">("idle");
  const [code, setCode] = useState("");
  const [device, setDevice] = useState<DeviceCodeState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Loopback login (desktop primary). On failure the browser already shows the
  // code/redirect, so drop straight into the paste input reusing that attempt's
  // pending PKCE — no fresh manualStart (docs/05).
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await login();
      onActivated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.oauth.signInFailed"));
      setMode("paste");
    } finally {
      setBusy(false);
    }
  };

  // Open the paste input, arming a fresh attempt (opens the authorize page).
  const startPaste = async () => {
    setBusy(true);
    setError(null);
    try {
      await codeFlow.manualStart();
      setMode("paste");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.oauth.openFailed"));
    } finally {
      setBusy(false);
    }
  };

  // Run the OpenAI device-code flow. runDeviceCode never rejects; it reports
  // every outcome through onState.
  const startDevice = () => {
    if (codeFlow.kind !== "device") return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setMode("device");
    setDevice({ status: "starting" });
    void codeFlow.runDeviceCode({
      signal: controller.signal,
      onState: (s) => {
        setDevice(s);
        if (s.status === "success") onActivated();
        else if (s.status === "cancelled") {
          setMode("idle");
          setDevice(null);
        }
      },
    });
  };

  const startCodeFlow = () => (codeFlow.kind === "device" ? startDevice() : void startPaste());

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await loginWithManualCode(code);
      setMode("idle");
      setCode("");
      onActivated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.oauth.invalidCode"));
    } finally {
      setBusy(false);
    }
  };

  const pasteHint =
    codeFlow.kind === "device"
      ? t("settings.oauth.pasteHintDevice")
      : t("settings.oauth.pasteHintCode");

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{name}</span>
        {provider?.configured && <span className="text-xs text-[#5fb236]">{t("settings.connected")}</span>}
      </div>
      {provider?.configured ? (
        // Not a full-width button, and not the filled one either: signing out is
        // the quiet way back out of a card that is already doing its job, and a
        // row-wide button there reads as the card's main action — the same
        // weight the sign-in button next door carries.
        <Button
          type="button"
          variant="subtle"
          className="self-start"
          onClick={async () => {
            await logout();
            onChanged();
          }}
        >
          {t("settings.signOut")}
        </Button>
      ) : (
        <>
          {ios ? (
            // No loopback on iOS: the code flow is the primary action.
            mode === "idle" && (
              <Button type="button" disabled={busy} onClick={startCodeFlow}>
                {busy ? t("settings.oauth.opening") : signInLabel}
              </Button>
            )
          ) : (
            <>
              <Button type="button" disabled={busy} onClick={signIn}>
                {busy ? t("settings.oauth.completeInBrowser") : signInLabel}
              </Button>
              {mode === "idle" && (
                <Button type="button" variant="link" size="link" className={LINK} disabled={busy} onClick={startCodeFlow}>
                  {t("settings.oauth.withCode")}
                </Button>
              )}
            </>
          )}

          {mode === "device" && (
            <DeviceCodePanel
              state={device}
              onOpen={(uri) => void openUrl(uri)}
              onCancel={() => abortRef.current?.abort()}
              onPaste={() => void startPaste()}
              onRetry={startDevice}
            />
          )}

          {mode === "paste" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <Input
                  placeholder={t("settings.oauth.pastePlaceholder")}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <Button type="button" variant="outline" disabled={busy || !code.trim()} onClick={submitCode}>
                  {t("settings.oauth.submit")}
                </Button>
              </div>
              <p className="m-0 text-xs text-faint-foreground">{pasteHint}</p>
            </div>
          )}

          <p className="m-0 text-xs text-faint-foreground">{t("settings.oauth.signsOutOthers")}</p>
        </>
      )}
      {error && <p className="m-0 text-xs text-destructive">{error}</p>}
    </div>
  );
}

// The OpenAI device-code sub-panel: shows the user code and verification link
// while polling, and the not-enabled / failed outcomes.
function DeviceCodePanel({
  state,
  onOpen,
  onCancel,
  onPaste,
  onRetry,
}: {
  state: DeviceCodeState | null;
  onOpen: (uri: string) => void;
  onCancel: () => void;
  onPaste: () => void;
  onRetry: () => void;
}) {
  const t = useT();
  if (!state || state.status === "starting") {
    return <p className="m-0 text-xs text-faint-foreground">{t("settings.oauth.requestingCode")}</p>;
  }
  if (state.status === "awaiting") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-border px-3 py-1.5 font-mono text-lg tracking-widest">
            {state.userCode}
          </span>
          <Button type="button" variant="outline" onClick={() => onOpen(state.verificationUri)}>
            {t("settings.oauth.openPage")}
          </Button>
        </div>
        <p className="m-0 text-xs text-faint-foreground">
          {t("settings.oauth.enterCode", { url: state.verificationUri })}
        </p>
        <Button type="button" variant="link" size="link" className={LINK} onClick={onCancel}>
          {t("settings.oauth.cancel")}
        </Button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-xs text-destructive">{state.message}</p>
        <div className="flex gap-3">
          {state.canPaste && (
            <Button type="button" variant="link" size="link" className={LINK} onClick={onPaste}>
              {t("settings.oauth.pasteInstead")}
            </Button>
          )}
          <Button type="button" variant="link" size="link" className={LINK} onClick={onRetry}>
            {t("settings.oauth.tryAgain")}
          </Button>
        </div>
      </div>
    );
  }
  // success is transient (the card re-renders as connected); cancelled resets to
  // idle in the parent. Nothing to draw here.
  return null;
}
