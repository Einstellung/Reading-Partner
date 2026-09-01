// Tool-call syntax that leaked into an observation body, and how it is taken
// back out. Moved here from reading/lecture/stuck.ts unchanged: the lecture
// prompt cleaned it on the way out, which left the file dirty and left the
// anchors the model had written inside the XML invisible to every index. The
// write path has to reach it too, and memory/ cannot be imported from a domain
// — so it lives where both sides can see it.

// Real entries on disk end with a stray `</body>` and a parameter tag: written
// by a model that was mid-tool-call when it wrote the observation. Harmless on
// disk, confusing in a prompt that is itself about to describe tools.
const TOOL_RESIDUE =
  /<\/?(?:antml:)?(?:body|parameter|function_calls|invoke|function_results|result)\b[^>]*>/gi;

export function stripToolResidue(body: string): string {
  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    TOOL_RESIDUE.lastIndex = 0;
    const cleaned = raw.replace(TOOL_RESIDUE, "");
    // A line that was nothing but a tag goes with it: leaving the blank behind
    // turns one stray tag into a paragraph break in the middle of a sentence.
    if (cleaned.trim() === "" && raw.trim() !== "") continue;
    if (cleaned.trim() === "" && lines[lines.length - 1]?.trim() === "") continue;
    lines.push(cleaned);
  }
  return lines.join("\n").trim();
}
