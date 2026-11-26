// The finishing-steps source the meals screens use: the logic of meals/finish
// with the host's region, which that directory cannot read itself.

import { finishSource, type FinishSource } from "../../../meals/finish/finish-view";
import { tonightNotes } from "../../../meals/finish/tonight";
import { finishingFor } from "../../../meals/finish/finishing";
import { hostRegion } from "../../../meals/region";

export const finishView: FinishSource = finishSource(finishingFor, tonightNotes, hostRegion);
