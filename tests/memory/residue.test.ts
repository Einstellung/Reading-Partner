// Tool-call syntax that leaked into a stored observation body
// (src/memory/observations/residue.ts). Measured on the owner's store
// 2026-08-28: 29 of 140 bodies carry some, the most recent written 2026-08-27.

import { expect, test } from "bun:test";
import { stripToolResidue } from "../../src/memory/observations/residue";

// Real entries on disk end with a stray closing tag and a parameter tag: written
// by a model that was mid-tool-call. Harmless on disk, confusing in a prompt
// that is itself about to describe tools.
test("tool-call syntax that leaked into a stored body is stripped", () => {
  const dirty = 'the prescription\n</body>\n<parameter name="summary">x</parameter>';
  expect(stripToolResidue(dirty)).toBe("the prescription\nx");
});
