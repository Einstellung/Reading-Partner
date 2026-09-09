import { describe, expect, test } from "bun:test";
import { coverWithinBody } from "../../../src/info/analysis/rules";
import type { Judgment, Likelihood } from "../../../src/info/picture/types";

function judgment(likelihood: Likelihood): Judgment {
  return {
    id: `j-${likelihood.slice(0, 6)}`,
    text: "something",
    likelihood,
    confidence: "moderate",
    date: "2026-09-09",
    cables: [],
  };
}

describe("coverWithinBody (en)", () => {
  test("a cover with no likelihood phrase always passes", () => {
    expect(coverWithinBody("Two fleets published their numbers.", [])).toEqual({ ok: true });
    expect(coverWithinBody("Two fleets published their numbers.", [judgment("likely")])).toEqual({
      ok: true,
    });
  });

  test("a cover at or below the strongest judgment passes", () => {
    expect(coverWithinBody("This is likely to continue.", [judgment("likely")]).ok).toBe(true);
    expect(coverWithinBody("This is likely to continue.", [judgment("almost-certain")]).ok).toBe(
      true,
    );
    expect(
      coverWithinBody("Unlikely to hold.", [judgment("unlikely"), judgment("very-likely")]).ok,
    ).toBe(true);
  });

  test("a cover claiming more than the body fails and names the phrase", () => {
    const out = coverWithinBody("A reversal is almost certain now.", [judgment("likely")]);
    expect(out.ok).toBe(false);
    expect(out.offending).toBe("almost certain");
  });

  test("with no judgment added today the cover may claim nothing", () => {
    expect(coverWithinBody("This is likely.", []).ok).toBe(false);
    expect(coverWithinBody("Nothing was decided.", []).ok).toBe(true);
  });

  test("a longer phrase is never read as the shorter one it contains", () => {
    // "very unlikely" must not register as the stronger "unlikely".
    expect(coverWithinBody("A halt is very unlikely.", [judgment("very-unlikely")]).ok).toBe(true);
    expect(coverWithinBody("It will probably not ship.", [judgment("unlikely")]).ok).toBe(true);
    // ...and the strongest phrase in the cover is the one that counts.
    const out = coverWithinBody("Unlikely at first, but very likely by winter.", [
      judgment("unlikely"),
    ]);
    expect(out.ok).toBe(false);
    expect(out.offending).toBe("very likely");
  });
});

describe("coverWithinBody (zh)", () => {
  test("passes when the Chinese phrase sits at or below the body", () => {
    expect(coverWithinBody("这件事有可能继续。", [judgment("likely")], "zh-CN").ok).toBe(true);
    expect(coverWithinBody("产量不太可能回升。", [judgment("unlikely")], "zh-CN").ok).toBe(true);
  });

  test("fails when the Chinese cover overclaims", () => {
    const out = coverWithinBody("几乎确定会翻盘。", [judgment("likely")], "zh-CN");
    expect(out.ok).toBe(false);
    expect(out.offending).toBe("几乎确定");
  });

  test("an English phrase in a Chinese cover is still checked", () => {
    const out = coverWithinBody("这轮 almost certain 会落地。", [judgment("roughly-even")], "zh-CN");
    expect(out.ok).toBe(false);
  });

  test("不太可能 does not read as the stronger 很可能", () => {
    expect(coverWithinBody("短期内不太可能。", [judgment("unlikely")], "zh-CN").ok).toBe(true);
  });

  test("a language with no list of its own still gets the English check", () => {
    expect(coverWithinBody("Es ist almost certain.", [judgment("likely")], "de").ok).toBe(false);
    expect(coverWithinBody("几乎确定。", [judgment("likely")], "de").ok).toBe(true);
  });
});
