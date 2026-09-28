// UI languages (docs/ui/81). No library: typed catalogs, one current locale,
// and t().

export {
  applyLanguageSetting,
  getLocale,
  localeForSetting,
  LOCALES,
  matchLocale,
  setLocale,
  subscribeLocale,
  systemLanguages,
  type Locale,
} from "./locale";
export {
  formatDateTime,
  formatNumber,
  t,
  translate,
  translatorFor,
  type MessageKey,
  type Translate,
} from "./translate";
export { useLocale, useT } from "./react";
