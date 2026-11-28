// The sign-in screen (docs/platform/713): Lumen needs an account. Google runs
// the same sign-in as Settings › AI & sync; Apple shows only once the native
// plugin is there to hand in.

import { useState } from "react";
import { useT } from "../../../i18n";
import { APPLE_SIGN_IN_AVAILABLE } from "../../../platform/license/config";
import type { LicenseGate } from "../../../platform/license/gate";
import { Button } from "../ui/button";
import { LicensePage } from "./LicensePage";
import { actionErrorKey } from "./license-text";

export function SignInScreen({
  gate,
  onApple,
}: {
  gate: LicenseGate;
  // Sign in with Apple, from the native plugin once it lands.
  onApple?: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    setBusy(true);
    setError(null);
    const result = await gate.signIn();
    setBusy(false);
    if (!result.ok) {
      const key = actionErrorKey(result.error);
      if (key) setError(t(key));
    }
  };

  return (
    <LicensePage title={t("shell.license.signIn.title")} body={t("shell.license.signIn.body")}>
      <Button size="lg" disabled={busy} onClick={google}>
        {busy ? t("shell.license.signIn.inBrowser") : t("shell.license.signIn.google")}
      </Button>
      {APPLE_SIGN_IN_AVAILABLE && onApple && (
        <Button size="lg" variant="outline" disabled={busy} onClick={() => void onApple()}>
          {t("shell.license.signIn.apple")}
        </Button>
      )}
      {error && <p className="m-0 text-sm text-destructive">{error}</p>}
    </LicensePage>
  );
}
