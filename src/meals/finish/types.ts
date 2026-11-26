// What a meal that eats from a prepped box shows on the eating day (docs/info/671).
export interface Finishing {
  /** One short line for the home card, e.g. "Heat the chicken box 3 min, stir-fry bok choy 4 min". */
  line: string;
  /** What to have out, by name, e.g. ["Chicken box", "Brown rice box", "Bok choy"]. Seasonings that are assumed at home (salt, oil) are listed last. */
  need: string[];
  /** The steps in order, plain sentences, 2 to 4 of them. */
  steps: string[];
}
