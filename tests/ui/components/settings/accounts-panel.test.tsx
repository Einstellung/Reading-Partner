// Settings › Accounts, drawn from fixed rows by a static render: the collector
// with a webview gets the buttons that fit each account, a reader gets the
// collector's report and none.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { accountRows } from "../../../../src/info/sources/accounts";
import { AccountsList } from "../../../../src/ui/components/settings/AccountsPanel";

const noop = () => {};
const rows = accountRows([], true);

test("a device that signs in gets Check plus Sign in or Sign out on every row", () => {
  const html = renderToStaticMarkup(
    <AccountsList
      rows={rows}
      context={{
        sessions: { "x.com": { signedIn: false, checkedAt: 1, expired: true } },
        busy: null,
        canSignIn: true,
      }}
      check={noop}
      signIn={noop}
      signOut={noop}
    />,
  );
  expect(html).toContain(">X<");
  expect(html).toContain(">Bloomberg<");
  expect(html).toContain("Expired");
  expect(html.match(/>Check</g)?.length).toBe(2);
  expect(html.match(/>Sign in</g)?.length).toBe(2);
  expect(html).toContain("your password never reaches this app");
  expect(html.match(/secondary account rather than your main one/g)?.length).toBe(1);
});

test("a reader's rows are read-only and say where the session is", () => {
  const html = renderToStaticMarkup(
    <AccountsList
      rows={rows}
      context={{
        sessions: {},
        busy: null,
        canSignIn: false,
        remote: { collector: { deviceName: "desk", sites: { "x.com": true } } },
      }}
      check={noop}
      signIn={noop}
      signOut={noop}
    />,
  );
  expect(html).toContain("Signed in on desk");
  expect(html).toContain("Needs signing in on desk");
  expect(html).not.toContain("<button");
});
