// Every catalog area, by the name its keys start with (docs/ui/81). One line
// per area; the area's own directory under messages/ holds its nine files.

import library from "./messages/library";
import reader from "./messages/reader";
import settings from "./messages/settings";
import shell from "./messages/shell";
import study from "./messages/study";

export const AREAS = {
  library,
  reader,
  settings,
  shell,
  study,
};
