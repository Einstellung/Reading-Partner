// What a thrown value says, for a log line or a message field.

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
