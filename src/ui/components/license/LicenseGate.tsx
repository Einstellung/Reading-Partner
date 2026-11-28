// The license gate's screens, mounted once by each shell (docs/platform/713).
// Renders nothing while the app is open, which is always while
// LICENSING_ENABLED is false: the gate is never started then.

import { useEffect, useSyncExternalStore } from "react";
import { licenseGate } from "../../../platform/license";
import { LockScreen } from "./LockScreen";
import { SignInScreen } from "./SignInScreen";

export function LicenseGate() {
  const view = useSyncExternalStore(licenseGate.subscribe, licenseGate.get, licenseGate.get);
  useEffect(() => licenseGate.start(), []);

  if (view.view === "sign-in") return <SignInScreen gate={licenseGate} />;
  if (view.view === "locked") return <LockScreen reason={view.reason} gate={licenseGate} />;
  return null;
}
