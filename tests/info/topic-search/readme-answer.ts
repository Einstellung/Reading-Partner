// A stand-in for GitHub's GET /repos/{owner}/{repo}/readme answer: JSON whose
// content is the README as base64.

export function readmeAnswer(markdown: string): { status: number; text: string } {
  const content = Buffer.from(markdown, "utf8").toString("base64");
  return { status: 200, text: JSON.stringify({ name: "README.md", encoding: "base64", content }) };
}
