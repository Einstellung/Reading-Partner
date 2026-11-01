// The finishing-steps source the meals screens use: the logic of info/meals/finish
// with the host's region, which that directory cannot read itself.

import { finishSource, type FinishSource } from "../../../../info/meals/finish/finish-view";
import { tonightNotes } from "../../../../info/meals/finish/tonight";
import { finishingFor } from "../../../../info/meals/finish/finishing";
import { hostRegion } from "../../../../info/meals/region";

export const finishView: FinishSource = finishSource(finishingFor, tonightNotes, hostRegion);
