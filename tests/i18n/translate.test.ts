// t(), the locale store and the matching of system languages (docs/ui/81).
// Run: bun test.

import { afterEach, expect, test } from "bun:test";
import {
  getLocale,
  localeForSetting,
  matchLocale,
  setLocale,
  subscribeLocale,
  t,
  translate,
  translatorFor,
} from "../../src/i18n";

const initial = getLocale();
afterEach(() => setLocale(initial));

test("system languages match onto the supported ones, first hit wins", () => {
  expect(matchLocale(["zh-CN"])).toBe("zh-CN");
  expect(matchLocale(["zh-Hans-CN"])).toBe("zh-CN");
  expect(matchLocale(["zh-TW"])).toBe("zh-CN");
  expect(matchLocale(["zh_HK"])).toBe("zh-CN");
  expect(matchLocale(["en-GB"])).toBe("en");
  expect(matchLocale(["pt-BR"])).toBe("pt");
  expect(matchLocale(["it-IT", "fr-CH", "en"])).toBe("fr");
  expect(matchLocale(["it-IT", "nl"])).toBe("en");
  expect(matchLocale([])).toBe("en");
});

test("auto follows the system, any other value is the locale itself", () => {
  expect(localeForSetting("auto", ["ja-JP"])).toBe("ja");
  expect(localeForSetting("auto", ["nl-NL"])).toBe("en");
  expect(localeForSetting("ko", ["ja-JP"])).toBe("ko");
});

test("t reads the current locale and interpolates", () => {
  setLocale("en");
  expect(t("settings.account.signInWith", { name: "Claude" })).toBe("Sign in with Claude");
  setLocale("ja");
  expect(t("settings.account.signInWith", { name: "Claude" })).toBe("Claude でサインイン");
});

test("a plural picks the form its language's rules name", () => {
  expect(translate("en", "settings.sync.minutesAgo", { count: 1 })).toBe("1 minute ago");
  expect(translate("en", "settings.sync.minutesAgo", { count: 5 })).toBe("5 minutes ago");
  expect(translate("ru", "settings.sync.minutesAgo", { count: 1 })).toBe("1 минуту назад");
  expect(translate("ru", "settings.sync.minutesAgo", { count: 3 })).toBe("3 минуты назад");
  expect(translate("ru", "settings.sync.minutesAgo", { count: 11 })).toBe("11 минут назад");
  expect(translate("ru", "settings.sync.minutesAgo", { count: 21 })).toBe("21 минуту назад");
});

test("an unknown key comes back as itself", () => {
  expect(translate("de", "settings.noSuchKey")).toBe("settings.noSuchKey");
  expect(translate("de", "noSuchArea.title")).toBe("noSuchArea.title");
});

test("a change of locale is announced once, and not for the same locale", () => {
  setLocale("en");
  let calls = 0;
  const off = subscribeLocale(() => calls++);
  setLocale("fr");
  setLocale("fr");
  off();
  setLocale("de");
  expect(calls).toBe(1);
});

test("a bound translator is the same function for the same locale", () => {
  expect(translatorFor("es")).toBe(translatorFor("es"));
  expect(translatorFor("es")).not.toBe(translatorFor("pt"));
  expect(translatorFor("es")("settings.title")).toBe("Ajustes");
});

// Compile-time only: tsconfig.test.json fails the typecheck if any of these
// stops being an error.
function typeChecks(): void {
  // @ts-expect-error a key that does not exist
  t("settings.titel");
  // @ts-expect-error a placeholder left out
  t("settings.account.signInWith");
  // @ts-expect-error a placeholder misnamed
  t("settings.account.signInWith", { nmae: "Claude" });
  // @ts-expect-error a plural without its count
  t("settings.sync.minutesAgo");
}
void typeChecks;
