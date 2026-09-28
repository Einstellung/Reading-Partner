// t(): a key into the catalogs, in the current locale (docs/ui/81).
//
// A key is "<area>.<name>", both halves checked against the English catalogs,
// and the params it needs are read off the English string: a key whose English
// has "{name}" demands { name }, and a plural demands { count }.

import { AREAS } from "./areas";
import { getLocale, SOURCE_LOCALE, type Locale } from "./locale";
import type { AreaMessages, Message, Plural } from "./messages/types";

type Areas = typeof AREAS;
type AreaName = keyof Areas & string;
type Source<A extends AreaName> = Areas[A]["en"];

export type MessageKey = {
  [A in AreaName]: `${A}.${keyof Source<A> & string}`;
}[AreaName];

type ValueOf<K extends string> = K extends `${infer A}.${infer N}`
  ? A extends AreaName
    ? N extends keyof Source<A>
      ? Source<A>[N]
      : never
    : never
  : never;

type Placeholders<S> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;

type ParamNames<V> = V extends string
  ? Placeholders<V>
  : V extends Plural
    ? Placeholders<V[keyof V]> | "count"
    : never;

export type Params = Readonly<Record<string, string | number>>;

// The arguments after the key: none for a plain string, the named values for
// one with placeholders.
export type ArgsFor<K extends MessageKey> = [ParamNames<ValueOf<K>>] extends [never]
  ? []
  : [params: { readonly [P in ParamNames<ValueOf<K>>]: string | number }];

export type Translate = <K extends MessageKey>(key: K, ...args: ArgsFor<K>) => string;

const REGISTRY = AREAS as unknown as Readonly<
  Record<string, Readonly<Record<Locale, AreaMessages>>>
>;

const pluralRules = new Map<Locale, Intl.PluralRules>();

function pluralForm(locale: Locale, message: Plural, count: unknown): string {
  if (typeof count !== "number") return message.other;
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  const category = rules.select(count) as keyof Plural;
  return message[category] ?? message.other;
}

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(text: string, params: Params | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

// The untyped core, for a caller that already has a locale in hand. A key the
// locale lacks falls back to English, and one English lacks comes back as is.
export function translate(locale: Locale, key: string, params?: Params): string {
  const dot = key.indexOf(".");
  const area = REGISTRY[key.slice(0, dot)];
  const name = key.slice(dot + 1);
  const message: Message | undefined = area?.[locale]?.[name] ?? area?.[SOURCE_LOCALE]?.[name];
  if (message === undefined) return key;
  const text = typeof message === "string" ? message : pluralForm(locale, message, params?.count);
  return interpolate(text, params);
}

// The current locale's t, for .ts code: an error message, a toast. A component
// takes useT() instead, so it redraws when the locale changes.
export const t: Translate = (key, ...args) => translate(getLocale(), key, args[0]);

const bound = new Map<Locale, Translate>();

// A t fixed to one locale. The same function for the same locale, so a
// component's memo keyed on it recomputes exactly when the language changes.
export function translatorFor(locale: Locale): Translate {
  let fn = bound.get(locale);
  if (!fn) {
    fn = (key, ...args) => translate(locale, key, args[0]);
    bound.set(locale, fn);
  }
  return fn;
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

export function formatDateTime(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(getLocale(), options).format(value);
}
