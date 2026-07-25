import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type DeviceCodeState, type ProviderInfo } from "../../../ai/aiClient";
import { isIOS } from "../../../platform/app/platform";
import { BTN, BTN_PRIMARY } from "../common/buttons";
import { CARD, FIELD } from "./cardStyles";

const LINK = "self-start bg-transparent border-0 p-0 text-xs text-[#6c4fd0] cursor-pointer hover:underline disabled:opacity-40 disabled:cursor-default";

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
      setError(e instanceof Error ? e.message : "Sign-in failed");
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
      setError(e instanceof Error ? e.message : "Could not open the sign-in page");
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
      setError(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const pasteHint =
    codeFlow.kind === "device"
      ? "After signing in, copy the address bar (the localhost URL that fails to load) and paste it here."
      : "Paste the code shown after you approve access.";

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{name}</span>
        {provider?.configured && <span className="text-xs text-[#5fb236]">Connected</span>}
      </div>
      {provider?.configured ? (
        <button
          type="button"
          className={BTN}
          onClick={async () => {
            await logout();
            onChanged();
          }}
        >
          Sign out
        </button>
      ) : (
        <>
          {ios ? (
            // No loopback on iOS: the code flow is the primary action.
            mode === "idle" && (
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={startCodeFlow}>
                {busy ? "Opening the sign-in page…" : signInLabel}
              </button>
            )
          ) : (
            <>
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={signIn}>
                {busy ? "Complete authorization in your browser…" : signInLabel}
              </button>
              {mode === "idle" && (
                <button type="button" className={LINK} disabled={busy} onClick={startCodeFlow}>
                  Sign in with a code
                </button>
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
                <input
                  className={FIELD}
                  placeholder="Paste sign-in code or URL"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <button type="button" className={BTN} disabled={busy || !code.trim()} onClick={submitCode}>
                  Submit
                </button>
              </div>
              <p className="m-0 text-xs text-[#777]">{pasteHint}</p>
            </div>
          )}

          <p className="m-0 text-xs text-[#777]">Signing in here signs out other providers.</p>
        </>
      )}
      {error && <p className="m-0 text-xs text-[#b91c1c]">{error}</p>}
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
  if (!state || state.status === "starting") {
    return <p className="m-0 text-xs text-[#777]">Requesting a sign-in code…</p>;
  }
  if (state.status === "awaiting") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-[#dcdcdc] px-3 py-1.5 font-mono text-lg tracking-widest">
            {state.userCode}
          </span>
          <button type="button" className={BTN} onClick={() => onOpen(state.verificationUri)}>
            Open sign-in page
          </button>
        </div>
        <p className="m-0 text-xs text-[#777]">
          Enter this code at {state.verificationUri}. Waiting for authorization…
        </p>
        <button type="button" className={LINK} onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-xs text-[#b91c1c]">{state.message}</p>
        <div className="flex gap-3">
          {state.canPaste && (
            <button type="button" className={LINK} onClick={onPaste}>
              Paste the sign-in URL instead
            </button>
          )}
          <button type="button" className={LINK} onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  // success is transient (the card re-renders as connected); cancelled resets to
  // idle in the parent. Nothing to draw here.
  return null;
}
