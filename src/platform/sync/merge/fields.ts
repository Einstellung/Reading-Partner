// The fields strategy: settings.json, prep-<hash>/state.json,
// notes-<bookId>/state.json. One three-way decision per key, recursing into
// nested objects. An array value is a scalar — the elements of these arrays
// (a chapter list, a paper list) are positional, and merging them elementwise
// would produce a list neither device ever had.

import type { DroppedRecord } from "./contract";
import {
  chooseByContent,
  isPlainObject,
  orderIds,
  pickByContent,
  sameValue,
  type Json,
} from "./text";

export interface FieldMerge {
  // Undefined when the key is gone from the merged result.
  value: Json | undefined;
  dropped: DroppedRecord[];
  contested: boolean;
}

export interface ObjectMerge {
  value: { [key: string]: Json };
  dropped: DroppedRecord[];
  contested: boolean;
}

// One key, against the base. `undefined` on any side means the key is absent
// there. The rules are the record rules: an edit outranks a delete, an add is
// kept, a delete both sides left alone goes through, and with no base nothing
// is ever removed.
export function mergeField(
  base: Json | undefined,
  local: Json | undefined,
  remote: Json | undefined,
  id: string,
): FieldMerge {
  if (local !== undefined && remote !== undefined && sameValue(local, remote)) {
    return { value: pickByContent(local, remote), dropped: [], contested: false };
  }

  if (base === undefined) {
    // No base: an absence cannot be told from a deletion, so it is an absence.
    if (local === undefined) return { value: remote, dropped: [], contested: false };
    if (remote === undefined) return { value: local, dropped: [], contested: false };
    return mergeBoth(base, local, remote, id);
  }

  if (local === undefined && remote === undefined) {
    return { value: undefined, dropped: [{ id, record: base }], contested: false };
  }
  // Gone from one side: a delete only wins over a value the other side left
  // alone, never over an edit.
  if (local === undefined) {
    if (sameValue(remote, base)) {
      return { value: undefined, dropped: [{ id, record: base }], contested: false };
    }
    return { value: remote, dropped: [], contested: false };
  }
  if (remote === undefined) {
    if (sameValue(local, base)) {
      return { value: undefined, dropped: [{ id, record: base }], contested: false };
    }
    return { value: local, dropped: [], contested: false };
  }

  if (sameValue(local, base)) return { value: remote, dropped: [], contested: false };
  if (sameValue(remote, base)) return { value: local, dropped: [], contested: false };
  return mergeBoth(base, local, remote, id);
}

// Both sides moved this key away from the base. Objects are opened up so two
// devices editing different settings both keep theirs; anything else is one
// value or the other, picked by content, with the value that lost journalled
// so it is still recoverable.
function mergeBoth(base: Json | undefined, local: Json, remote: Json, id: string): FieldMerge {
  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeObject(isPlainObject(base) ? base : undefined, local, remote, id);
  }
  const { winner, loser } = chooseByContent(local, remote);
  return { value: winner, dropped: [{ id, record: loser }], contested: true };
}

// Key by key, in the base's order so a file only one side touched comes back
// looking exactly like that side.
export function mergeObject(
  base: { [key: string]: Json } | undefined,
  local: { [key: string]: Json },
  remote: { [key: string]: Json },
  prefix: string,
): ObjectMerge {
  const order = orderIds(base ? Object.keys(base) : [], Object.keys(local), Object.keys(remote));
  const value: { [key: string]: Json } = {};
  const dropped: DroppedRecord[] = [];
  let contested = false;

  for (const key of order) {
    const merged = mergeField(
      base ? base[key] : undefined,
      local[key],
      remote[key],
      prefix ? `${prefix}.${key}` : key,
    );
    dropped.push(...merged.dropped);
    contested = contested || merged.contested;
    if (merged.value !== undefined) value[key] = merged.value;
  }
  return { value, dropped, contested };
}
