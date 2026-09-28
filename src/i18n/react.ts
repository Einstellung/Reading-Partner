// The locale store as React sees it: a component that calls either hook redraws
// the moment the language setting changes.

import { useSyncExternalStore } from "react";
import { getLocale, subscribeLocale, type Locale } from "./locale";
import { translatorFor, type Translate } from "./translate";

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function useT(): Translate {
  return translatorFor(useLocale());
}
