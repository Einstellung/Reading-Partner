// When an X post was made, read from its status id (docs/88: the program, not a
// page or a model, writes a post's time). X ids are snowflakes: the top bits
// are milliseconds since X's epoch, shifted left 22.
//
// The decoding is ported from last30days-skill (lib/x_api.py, _decode_snowflake).
// Portions Copyright (c) 2026 Matt Van Horn, under the MIT License; the full
// notice is in src/info/rank/third-party-licenses.txt.

/** X's snowflake epoch, 2010-11-04T01:42:54.657Z. */
export const SNOWFLAKE_EPOCH_MS = 1288834974657;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Epoch milliseconds a status id was minted at, or null when the id is not a
 * positive decimal integer. Ids exceed 2^53, so the shift is done on a bigint.
 */
export function snowflakeTime(id: string): number | null {
  const s = id.trim();
  if (!/^\d{1,20}$/.test(s)) return null;
  const value = BigInt(s);
  if (value <= 0n) return null;
  return Number((value >> 22n) + BigInt(SNOWFLAKE_EPOCH_MS));
}

/**
 * Whether the time a page showed for a post agrees with its id: within a day
 * (docs/88 drops a post whose two times differ by more). An id that does not
 * decode never agrees.
 */
export function snowflakeAgrees(id: string, shownAt: number, toleranceMs: number = DAY_MS): boolean {
  const at = snowflakeTime(id);
  return at !== null && Math.abs(at - shownAt) <= toleranceMs;
}
