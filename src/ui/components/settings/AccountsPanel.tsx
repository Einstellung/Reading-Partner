// Settings, Accounts tab: every account the app can use, one row each, with
// where it stands and the way to sign in or out (docs/north-star/accounts.md).
// What a row says is info/sources/accounts.ts (accountView); the state and the
// gestures are use-accounts.ts. Rendering and event binding only.

import { useT } from "../../../i18n";
import type { DeviceRole } from "../../../platform/app/device";
import {
  accountView,
  type AccountContext,
  type AccountRow,
  type AccountStatus,
} from "../../../info/sources/accounts";
import type { SignInSite } from "../../../info/sources/site-session";
import { Button } from "../ui/button";
import { CARD } from "./cardStyles";
import { SETTINGS_PANEL } from "./SettingsSection";
import { useAccounts } from "./use-accounts";

const DOT: Record<AccountStatus, string> = {
  "signed-in": "bg-[#3fb950]",
  expired: "bg-[#e3b341]",
  "signed-out": "bg-muted-strong",
  unknown: "bg-muted-strong",
};

export interface AccountsListProps {
  rows: AccountRow[];
  context: AccountContext;
  check: (site: SignInSite) => void;
  signIn: (site: SignInSite) => void;
  signOut: (site: SignInSite) => void;
}

function AccountRowView({ row, accounts }: { row: AccountRow; accounts: AccountsListProps }) {
  const t = useT();
  const { site } = row;
  const view = accountView(row, accounts.context);
  const working = view.work !== null;
  return (
    <li className={CARD}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${DOT[view.status]}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-foreground">{row.name}</div>
          <div className="text-[13px] text-muted-foreground">{view.line}</div>
          <div className="mt-0.5 text-[12px] text-faint-foreground">{view.detail}</div>
        </div>
        {view.action && (
          <div className="flex flex-none flex-wrap justify-end gap-2">
            <Button
              variant="subtle"
              size="chip"
              disabled={working}
              onClick={() => accounts.check(site)}
              title={t("sources.checkTitle")}
            >
              {t("sources.check")}
            </Button>
            {view.action === "sign-out" ? (
              <Button variant="subtle" size="chip" disabled={working} onClick={() => accounts.signOut(site)}>
                {t("sources.signOut")}
              </Button>
            ) : (
              <Button variant="cta" size="chip" disabled={working} onClick={() => accounts.signIn(site)}>
                {t("sources.signIn")}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function AccountsPanel({ role }: { role: DeviceRole | null }) {
  return <AccountsList {...useAccounts(role)} />;
}

// The page without its state, so a test or a harness can hand it rows.
export function AccountsList(accounts: AccountsListProps) {
  const t = useT();
  return (
    <div className={SETTINGS_PANEL}>
      <section className="flex flex-col gap-2">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {accounts.rows.map((row) => (
            <AccountRowView key={row.id} row={row} accounts={accounts} />
          ))}
        </ul>
        {accounts.context.canSignIn && (
          <p className="m-0 text-xs leading-relaxed text-faint-foreground">{t("sources.signInNote")}</p>
        )}
      </section>
    </div>
  );
}
