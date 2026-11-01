// Stub: the real implementation lands with the eating-day logic (docs/info/671).

import type { Locale } from "../../../i18n";
import type { Profile } from "../nutrition/targets";
import type { MealView } from "../screen/view";
import type { Finishing } from "./types";

export function finishingFor(_view: MealView, _profile: Profile, _language: Locale): Finishing | null {
  return null;
}
