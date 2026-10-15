// A question asked about a passage (docs/info/88 「简报的对话」): the line the
// reader sends carries the passage as a Markdown quote above what they typed,
// which is how the model reads it and how the row draws it. One line of quote,
// a blank line, then the question.

/** The line sent for a question about a passage. */
export function quotedQuestion(quote: string, question: string): string {
  const passage = quote.replace(/\s+/g, " ").trim();
  const asked = question.trim();
  if (!passage) return asked;
  return `> ${passage}\n\n${asked}`;
}

/** The passage and the question out of a sent line; a line that quotes nothing is all question. */
export function splitQuotedQuestion(text: string): { quote: string | null; question: string } {
  const match = /^> ([^\n]+)\n\n([\s\S]*)$/.exec(text);
  return match ? { quote: match[1], question: match[2] } : { quote: null, question: text };
}
