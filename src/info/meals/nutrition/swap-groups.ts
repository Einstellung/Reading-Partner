// Swap groups (docs/671 替换组): foods that stand in for each other when one
// cannot be bought where the user lives. The program owns the groups; foods.ts
// stamps each member's `swapGroup` from this one table, so a food is in at
// most one group. Tiers are tried in order: the same tier first, then later
// ones. Nothing outside a group is ever swapped in.

/**
 * What the grams are rescaled by when a member replaces another: protein for
 * protein foods, kcal for staples, weight for greens. A line's own role wins
 * over the group's basis (a bean line that is the dish's staple keeps its
 * kcal), see dishes/swap.ts.
 */
export type SwapBasis = "protein" | "kcal" | "weight";

export interface SwapGroup {
  id: string;
  basis: SwapBasis;
  /** Food ids, best tier first. */
  tiers: readonly (readonly string[])[];
}

export const SWAP_GROUPS: readonly SwapGroup[] = [
  {
    // Cans everywhere in the US and Europe, import shelves in China; dry beans
    // in the pressure cooker next; edamame and tofu last.
    id: "beans",
    basis: "protein",
    tiers: [
      ["canned_kidney_beans", "canned_chickpeas", "canned_black_beans"],
      ["kidney_beans_dry", "chickpeas_dry", "black_soybean_dry"],
      ["frozen_edamame", "firm_tofu"],
    ],
  },
  { id: "flatbread", basis: "kcal", tiers: [["whole_wheat_pita", "corn_tortilla", "whole_wheat_tortilla", "steamed_bun"]] },
  { id: "noodles", basis: "kcal", tiers: [["soba_dry", "whole_wheat_pasta_dry", "pasta_dry", "rice_noodles_dry"]] },
  { id: "whole_grains", basis: "kcal", tiers: [["brown_rice_cooked", "multigrain_rice_raw", "quinoa_cooked", "millet_raw"]] },
  { id: "white_fish", basis: "protein", tiers: [["cod", "frozen_tilapia_fillet", "basa_fillet"]] },
  {
    id: "canned_fish",
    basis: "protein",
    tiers: [["canned_tuna_water", "canned_salmon", "canned_mackerel_tomato", "canned_sardine"]],
  },
  { id: "leafy_greens", basis: "weight", tiers: [["spinach", "bok_choy"]] },
];

const BY_ID: ReadonlyMap<string, SwapGroup> = new Map(SWAP_GROUPS.map((g) => [g.id, g]));

export function swapGroupById(id: string): SwapGroup | undefined {
  return BY_ID.get(id);
}

/** Food id to its group id, built from the table. */
export const SWAP_GROUP_OF: ReadonlyMap<string, string> = new Map(
  SWAP_GROUPS.flatMap((g) => g.tiers.flat().map((food) => [food, g.id] as const)),
);
