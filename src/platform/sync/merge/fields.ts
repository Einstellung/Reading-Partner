// The fields strategy: settings.json and both of a document's prep states,
// prep-<hash>/state.json and prep-<hash>/chapters/state.json. One three-way
// decision per key, recursing into
// nested objects. An array value is a scalar — the elements of these arrays
// (a chapter list, a paper list) are positional, and merging them elementwise
// would produce a list neither device ever had.
//
// Some keys cannot be decided on their own. The file names them as a group
// (fieldGroupsFor, contract.ts) and the group is settled as one composite
// value: without that, two keys that only mean something as a pair each get
// their own coin flip and the file comes back holding a combination neither
// device ever had (pitfall 237).
//
// The cursors strategy is this one with a rule for the scalars both devices
// moved (cursors.ts), which is why the tie-break is a parameter.

import type { DroppedRecord, FieldGroups } from "./contract";
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

type JsonObject = { [key: string]: Json };

// How a file settles two scalars both devices moved. Defaults to content order,
// which is arbitrary but identical on both devices; a file whose values mean
// something to compare passes its own rule (cursors.ts). It must stay symmetric
// and idempotent for the same reason everything else here is: both devices run
// this over the same pair and have to land on the same bytes.
export type ResolveConflict = (local: Json, remote: Json) => { winner: Json; loser: Json };

// One key, against the base. `undefined` on any side means the key is absent
// there. The rules are the record rules: an edit outranks a delete, an add is
// kept, a delete both sides left alone goes through, and with no base nothing
// is ever removed.
export function mergeField(
  base: Json | undefined,
  local: Json | undefined,
  remote: Json | undefined,
  id: string,
  resolve: ResolveConflict = chooseByContent,
  groups: FieldGroups = [],
): FieldMerge {
  if (local !== undefined && remote !== undefined && sameValue(local, remote)) {
    return { value: pickByContent(local, remote), dropped: [], contested: false };
  }

  if (base === undefined) {
    // No base: an absence cannot be told from a deletion, so it is an absence.
    if (local === undefined) return { value: remote, dropped: [], contested: false };
    if (remote === undefined) return { value: local, dropped: [], contested: false };
    return mergeBoth(base, local, remote, id, resolve, groups);
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
  return mergeBoth(base, local, remote, id, resolve, groups);
}

// Both sides moved this key away from the base. Objects are opened up so two
// devices editing different settings both keep theirs; anything else is one
// value or the other, settled by the file's own rule, with the value that lost
// journalled so it is still recoverable.
function mergeBoth(
  base: Json | undefined,
  local: Json,
  remote: Json,
  id: string,
  resolve: ResolveConflict,
  groups: FieldGroups,
): FieldMerge {
  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeObject(isPlainObject(base) ? base : undefined, local, remote, id, resolve, groups);
  }
  const { winner, loser } = resolve(local, remote);
  return { value: winner, dropped: [{ id, record: loser }], contested: true };
}

// The groups binding keys of the object at `prefix`, as bare key names. A group
// with fewer than two members here binds nothing at this level: its other
// members sit under some other object, and a lone key is what mergeField
// already decides.
function groupsAtPrefix(groups: FieldGroups, prefix: string): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const group of groups) {
    const here: string[] = [];
    for (const path of group) {
      const dot = path.lastIndexOf(".");
      if ((dot === -1 ? "" : path.slice(0, dot)) === prefix) here.push(path.slice(dot + 1));
    }
    if (here.length < 2) continue;
    for (const key of here) out.set(key, here);
  }
  return out;
}

// Which of the two composites the merged file keeps. mergeField's rules, read
// over the whole group rather than over one key: the two sides saying the same
// thing is taken, a side still on the base yields to the other, and otherwise
// the file's own tie-break picks one group entire. `resolve` falls back to
// content order for anything that is not a number, so an object is safe to hand
// it.
function settleGroup(
  baseGroup: JsonObject | undefined,
  localGroup: JsonObject,
  remoteGroup: JsonObject,
  resolve: ResolveConflict,
): { winner: JsonObject; contested: boolean } {
  if (sameValue(localGroup, remoteGroup)) {
    return { winner: pickByContent(localGroup, remoteGroup) as JsonObject, contested: false };
  }
  if (baseGroup === undefined) {
    // No base: a group this side does not have is an absence, not a deletion.
    if (Object.keys(localGroup).length === 0) return { winner: remoteGroup, contested: false };
    if (Object.keys(remoteGroup).length === 0) return { winner: localGroup, contested: false };
  } else {
    if (sameValue(localGroup, baseGroup)) return { winner: remoteGroup, contested: false };
    if (sameValue(remoteGroup, baseGroup)) return { winner: localGroup, contested: false };
  }
  return { winner: resolve(localGroup, remoteGroup).winner as JsonObject, contested: true };
}

// A group settled as one value, handed back as one FieldMerge per key so the
// caller writes the members into the positions they already held and journals
// them the way it journals any other key.
//
// A member is journalled when a side wrote a value the winning group does not
// carry and the base did not already hold — the same test mergeField makes, so
// a value a device merely inherited is not journalled, and a key that leaves
// the file entirely still leaves the base's value behind.
function mergeGroup(
  base: JsonObject | undefined,
  local: JsonObject,
  remote: JsonObject,
  keys: readonly string[],
  prefix: string,
  resolve: ResolveConflict,
): Map<string, FieldMerge> {
  const subset = (from: JsonObject): JsonObject => {
    const out: JsonObject = {};
    for (const key of keys) if (from[key] !== undefined) out[key] = from[key];
    return out;
  };
  const localGroup = subset(local);
  const remoteGroup = subset(remote);
  const baseGroup = base === undefined ? undefined : subset(base);
  const { winner, contested } = settleGroup(baseGroup, localGroup, remoteGroup, resolve);

  const fields = new Map<string, FieldMerge>();
  for (const key of keys) {
    const kept = winner[key];
    const inBase = baseGroup === undefined ? undefined : baseGroup[key];
    const id = prefix ? `${prefix}.${key}` : key;
    const dropped: DroppedRecord[] = [];
    for (const side of [localGroup[key], remoteGroup[key]]) {
      if (side === undefined || sameValue(side, kept) || sameValue(side, inBase)) continue;
      dropped.push({ id, record: side });
    }
    if (kept === undefined && inBase !== undefined && dropped.length === 0) {
      dropped.push({ id, record: inBase });
    }
    fields.set(key, { value: kept, dropped, contested });
  }
  return fields;
}

// Key by key, in the base's order so a file only one side touched comes back
// looking exactly like that side. A grouped key is settled the first time the
// order reaches any member of its group, and each member then reads its own
// answer off that single decision — the slot every key is written into is still
// the one orderIds gave it.
export function mergeObject(
  base: JsonObject | undefined,
  local: JsonObject,
  remote: JsonObject,
  prefix: string,
  resolve: ResolveConflict = chooseByContent,
  groups: FieldGroups = [],
): ObjectMerge {
  const order = orderIds(base ? Object.keys(base) : [], Object.keys(local), Object.keys(remote));
  const bound = groupsAtPrefix(groups, prefix);
  const settled = new Map<string, FieldMerge>();
  const value: JsonObject = {};
  const dropped: DroppedRecord[] = [];
  let contested = false;

  for (const key of order) {
    const group = bound.get(key);
    if (group !== undefined && !settled.has(key)) {
      for (const [member, field] of mergeGroup(base, local, remote, group, prefix, resolve)) {
        settled.set(member, field);
      }
    }
    const merged =
      settled.get(key) ??
      mergeField(
        base ? base[key] : undefined,
        local[key],
        remote[key],
        prefix ? `${prefix}.${key}` : key,
        resolve,
        groups,
      );
    dropped.push(...merged.dropped);
    contested = contested || merged.contested;
    if (merged.value !== undefined) value[key] = merged.value;
  }
  return { value, dropped, contested };
}
