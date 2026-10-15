// Lumen's first words when a brief is opened (docs/info/88 「简报的对话」): which
// items are worth reading, with page cites, and up to three questions saved up
// for the reader, each with quick answers.
//
// The door calls this once the day's conversation is loaded for an issue that
// was just opened (ui/components/lumen/use-door-chat.ts). It is the next
// slice's; nothing is said yet.

export interface IssueOpening {
  /** The issue opened. */
  bookId: string;
  /** The day's conversation at the door it speaks into (soul/door.ts). */
  date: string;
  threadId: string;
}

export async function speakIssueOpening(_opening: IssueOpening): Promise<void> {
  // TODO(docs/info/88): write the opening into the door's conversation.
}
