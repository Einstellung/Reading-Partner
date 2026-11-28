// Which sentence each license state and failure is said with (docs/platform/713).

import type { MessageKey } from "../../../i18n";
import type { LockAction, LockReason } from "../../../platform/license/decide";
import type { ActionError } from "../../../platform/license/gate";

// The gate's sentences that take no parameter: every one but Buy's.
type LicenseKey = Exclude<Extract<MessageKey, `shell.license.${string}`>, "shell.license.buy">;

export function lockTitleKey(reason: LockReason): LicenseKey {
  switch (reason) {
    case "expired":
      return "shell.license.lock.expiredTitle";
    case "banned":
      return "shell.license.lock.bannedTitle";
    case "offline":
      return "shell.license.lock.offlineTitle";
  }
}

export function lockBodyKey(reason: LockReason): LicenseKey {
  switch (reason) {
    case "expired":
      return "shell.license.lock.expiredBody";
    case "banned":
      return "shell.license.lock.bannedBody";
    case "offline":
      return "shell.license.lock.offlineBody";
  }
}

// Null where the press needs no sentence: the buyer cancelled the sheet.
export function actionErrorKey(error: ActionError): LicenseKey | null {
  switch (error) {
    case "cancelled":
      return null;
    case "unavailable":
      return "shell.license.error.unavailable";
    case "pending":
      return "shell.license.error.pending";
    case "failed":
      return "shell.license.error.failed";
  }
}

// The label of every action but Buy, which carries the price.
export function actionLabelKey(action: Exclude<LockAction, "buy">): LicenseKey {
  switch (action) {
    case "restore":
      return "shell.license.restore";
    case "delete-account":
      return "shell.license.deleteAccount";
    case "sign-out":
      return "shell.license.signOut";
    case "retry":
      return "shell.license.retry";
  }
}
