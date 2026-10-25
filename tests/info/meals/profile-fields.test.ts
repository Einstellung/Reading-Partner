// The planner's profile fields (docs/671 数据模型): unavailable foods, cook
// slots, boxes and burners, through the tool's patch and the file's validator.
// Run: scripts/t.sh tests/info/meals/profile-fields.test.ts

import { describe, expect, test } from "bun:test";
import { validateProfile } from "../../../src/info/meals/plan/store";
import { patchProfile } from "../../../src/info/meals/tools";
import { profile } from "./fixtures/week";

describe("patchProfile", () => {
  test("keeps well-formed values", () => {
    const next = patchProfile(profile(), {
      unavailable: ["canned_chickpeas", "whole_wheat_pita"],
      cookSlots: [
        { weekday: 6, part: "morning" },
        { weekday: 7, part: "afternoon" },
      ],
      boxes: true,
      burners: 2,
    });
    expect(next).toMatchObject({
      unavailable: ["canned_chickpeas", "whole_wheat_pita"],
      cookSlots: [
        { weekday: 6, part: "morning" },
        { weekday: 7, part: "afternoon" },
      ],
      boxes: true,
      burners: 2,
    });
  });

  test("touches nothing else, and does not change the profile it was given", () => {
    const base = profile();
    const copy = structuredClone(base);
    const next = patchProfile(base, { boxes: true });
    expect(base).toEqual(copy);
    expect({ ...next, boxes: undefined }).toEqual({ ...base, boxes: undefined });
  });

  describe("unavailable", () => {
    test("drops ids the food table lacks, blanks and non-strings", () => {
      const next = patchProfile(profile(), { unavailable: ["canned_chickpeas", "no_such_food", " ", "", " firm_tofu "] });
      expect(next?.unavailable).toEqual(["canned_chickpeas", "firm_tofu"]);
    });

    test("an empty list clears it; a list of only unknown ids is an empty list, not a no-op", () => {
      const had = profile({ unavailable: ["canned_chickpeas"] });
      expect(patchProfile(had, { unavailable: [] })?.unavailable).toEqual([]);
      expect(patchProfile(had, { unavailable: ["no_such_food"] })?.unavailable).toEqual([]);
    });

    test("a value that is not a list is ignored", () => {
      expect(patchProfile(profile(), { unavailable: "canned_chickpeas" })).toBeNull();
      expect(patchProfile(profile(), { unavailable: null })).toBeNull();
    });
  });

  describe("cookSlots", () => {
    test("drops a slot with a bad weekday or part, and anything that is not an object", () => {
      const next = patchProfile(profile(), {
        cookSlots: [
          { weekday: 0, part: "morning" },
          { weekday: 8, part: "morning" },
          { weekday: 3, part: "night" },
          { weekday: "x", part: "evening" },
          { part: "evening" },
          "sunday",
          null,
          42,
          { weekday: 7, part: "evening" },
        ],
      });
      expect(next?.cookSlots).toEqual([{ weekday: 7, part: "evening" }]);
    });

    test("reads the part case-insensitively and rounds the weekday", () => {
      expect(patchProfile(profile(), { cookSlots: [{ weekday: 6.4, part: "Morning" }] })?.cookSlots).toEqual([
        { weekday: 6, part: "morning" },
      ]);
    });

    test("an empty list clears it; a non-list is ignored", () => {
      const had = profile({ cookSlots: [{ weekday: 6, part: "morning" }] });
      expect(patchProfile(had, { cookSlots: [] })?.cookSlots).toEqual([]);
      expect(patchProfile(had, { cookSlots: { weekday: 6, part: "morning" } })).toBeNull();
    });
  });

  describe("boxes and burners", () => {
    test("boxes takes only a boolean, and false is a real answer", () => {
      expect(patchProfile(profile({ boxes: true }), { boxes: false })?.boxes).toBe(false);
      expect(patchProfile(profile(), { boxes: "yes" })).toBeNull();
      expect(patchProfile(profile(), { boxes: 1 })).toBeNull();
    });

    test("burners is a whole number from 1 to 10", () => {
      expect(patchProfile(profile(), { burners: 2.6 })?.burners).toBe(3);
      expect(patchProfile(profile(), { burners: 10 })?.burners).toBe(10);
      expect(patchProfile(profile(), { burners: 0 })).toBeNull();
      expect(patchProfile(profile(), { burners: -1 })).toBeNull();
      expect(patchProfile(profile(), { burners: 11 })).toBeNull();
      expect(patchProfile(profile(), { burners: "two" })).toBeNull();
    });

    test("a bad value beside a good one drops only the bad one", () => {
      const next = patchProfile(profile({ burners: 2 }), { burners: 0, boxes: true });
      expect(next).toMatchObject({ burners: 2, boxes: true });
    });
  });
});

describe("validateProfile", () => {
  const written = () => ({ ...profile() }) as Record<string, unknown>;

  test("a profile without the new fields reads as it was", () => {
    const out = validateProfile(written());
    expect(out).toEqual(profile());
    for (const key of ["unavailable", "cookSlots", "boxes", "burners"]) expect(out).not.toHaveProperty(key);
  });

  test("keeps well-formed values", () => {
    const raw = {
      ...written(),
      unavailable: ["canned_chickpeas"],
      cookSlots: [{ weekday: 6, part: "morning" }, { weekday: 7, part: "evening" }],
      boxes: false,
      burners: 3,
    };
    expect(validateProfile(raw)).toMatchObject({
      unavailable: ["canned_chickpeas"],
      cookSlots: [{ weekday: 6, part: "morning" }, { weekday: 7, part: "evening" }],
      boxes: false,
      burners: 3,
    });
  });

  test("drops malformed fields and keeps the profile", () => {
    const out = validateProfile({
      ...written(),
      unavailable: ["canned_chickpeas", 7],
      cookSlots: "saturday",
      boxes: "yes",
      burners: "2",
    });
    expect(out).toEqual(profile());
  });

  test("drops a cook slot with a bad part or a non-number weekday and keeps the rest", () => {
    const out = validateProfile({
      ...written(),
      cookSlots: [{ weekday: 6, part: "night" }, { weekday: "6", part: "morning" }, null, "x", { weekday: 7, part: "evening" }],
    });
    expect(out?.cookSlots).toEqual([{ weekday: 7, part: "evening" }]);
  });

  test("a profile whose required fields are broken is still rejected", () => {
    expect(validateProfile({ ...written(), weightKg: "60" })).toBeNull();
    expect(validateProfile({ ...written(), unavailable: ["canned_chickpeas"], dislikes: "fish" })).toBeNull();
    expect(validateProfile(null)).toBeNull();
    expect(validateProfile("profile")).toBeNull();
  });

  test("a patched profile survives the file round trip", () => {
    const patched = patchProfile(profile(), {
      unavailable: ["canned_chickpeas", "no_such_food"],
      cookSlots: [{ weekday: 6, part: "morning" }],
      boxes: true,
      burners: 2,
    })!;
    expect(validateProfile(JSON.parse(JSON.stringify(patched)))).toEqual(patched);
  });
});
