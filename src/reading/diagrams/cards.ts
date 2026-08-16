// The chat-card payload for a drawn diagram. Kept in the domain, beside the DSL
// the tool writes and the layout that draws it, so the tool and the component
// import one definition and the dependency direction stays components -> reading.

import type { Diagram } from "./types";

// Durable. A diagram is part of the explanation it belongs to — reopening the
// thread and finding the picture gone would leave prose referring to something
// that is not there. It is cheap to keep: what is stored is the DSL, a few
// hundred bytes of structure, and the picture is recomputed from it on open.
// Nothing rendered is ever persisted.
export interface DiagramCardData {
  kind: "diagram";
  diagram: Diagram;
  // Which stage the reader has stepped to, for a staged diagram. Kept in the
  // payload rather than in the part's view state because it is persisted: a
  // reader who stepped to the last stage and comes back tomorrow should not find
  // the picture rewound to the first.
  stage?: number;
}

// Every card the diagrams unit contributes to the chat's payload union.
export type DiagramCard = DiagramCardData;
