// Every catalog area, by the name its keys start with (docs/ui/81). One line
// per area; the area's own directory under messages/ holds its nine files.

import library from "./messages/library";
import reader from "./messages/reader";
import phone from "./messages/phone";
import info from "./messages/info";
import settings from "./messages/settings";
import shell from "./messages/shell";
import study from "./messages/study";
import sources from "./messages/sources";

export const AREAS = {
  library,
  reader,
  info,
  settings,
  shell,
  study,
  phone,
  sources,
};
