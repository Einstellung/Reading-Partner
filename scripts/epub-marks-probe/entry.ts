// What the probe page calls: the column's marks layer as the reader runs it,
// the sheets' pen stroke (mark-layer.ts), and the word rule a hold uses. Bundled for the browser by run.sh.

import { caretAtPoint, charSpanUnder, strokeRange } from "../../src/reading/epub/caret";
import { createFlowMarks } from "../../src/reading/epub/flow/flow-marks";
import { wordBoundsAt } from "../../src/reading/epub/word";

(window as unknown as { RP: unknown }).RP = { caretAtPoint, charSpanUnder, strokeRange, createFlowMarks, wordBoundsAt };
