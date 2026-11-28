// The lock screen (docs/platform/713): the trial has ended, the account is
// suspended, or the server has been out of reach past the grace period. Only
// the actions lockActions() names for the reason; no way into the app.

import { useState } from "react";
import { useT } from "../../../i18n";
// The headless parts, not the index: that one binds the host, and these
// screens are rendered by tests without one. LicenseGate.tsx hands the live
// gate in.
import { LIFETIME_PRICE } from "../../../platform/license/config";
import { lockActions, type LockReason } from "../../../platform/license/decide";
import type { ActionResult, LicenseGate } from "../../../platform/license/gate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { LicensePage } from "./LicensePage";
import { actionErrorKey, actionLabelKey, lockBodyKey, lockTitleKey } from "./license-text";

export function LockScreen({ reason, gate }: { reason: LockReason; gate: LicenseGate }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<ActionResult>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      const key = actionErrorKey(result.error);
      if (key) setError(t(key));
    }
  };

  return (
    <LicensePage title={t(lockTitleKey(reason))} body={t(lockBodyKey(reason))}>
      {lockActions(reason).map((action) => {
        switch (action) {
          case "buy":
            return (
              <Button key={action} size="lg" disabled={busy} onClick={() => run(gate.buy)}>
                {t("shell.license.buy", { price: LIFETIME_PRICE })}
              </Button>
            );
          case "retry":
            return (
              <Button key={action} size="lg" disabled={busy} onClick={() => run(gate.retry)}>
                {t(actionLabelKey(action))}
              </Button>
            );
          case "restore":
            return (
              <Button key={action} size="lg" variant="outline" disabled={busy} onClick={() => run(gate.restore)}>
                {t(actionLabelKey(action))}
              </Button>
            );
          case "sign-out":
            return (
              <Button key={action} size="lg" variant="subtle" disabled={busy} onClick={() => run(gate.signOut)}>
                {t(actionLabelKey(action))}
              </Button>
            );
          case "delete-account":
            return (
              <AlertDialog key={action}>
                <AlertDialogTrigger asChild>
                  <Button size="lg" variant="destructive-outline" disabled={busy}>
                    {t(actionLabelKey(action))}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("shell.license.delete.title")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("shell.license.delete.body")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("shell.action.cancel")}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => run(gate.deleteAccount)}>
                      {t("shell.license.deleteAccount")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            );
        }
      })}
      {error && <p className="m-0 text-sm text-destructive">{error}</p>}
    </LicensePage>
  );
}
