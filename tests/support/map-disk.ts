// The disk the file-backed stores are tested over: one Map, listed by its own
// keys. Every store that takes its io as a parameter (box, run, bell, ledger)
// gets one of these rather than the fake AppData, whose readDir answers the
// whole disk whatever directory it was handed (pitfall 344).
//
// A fresh Map per call and no module-level state, so two files that each make
// one cannot see each other's writes.
//
// The io interfaces differ in whether they have `remove`; this has it, and a
// store whose type does not mention it simply never calls it. `writes` records
// the names in the order they were written, which is what the tests about
// write order read.

export interface MapDisk {
  files: Map<string, string>;
  writes: string[];
  list(): Promise<string[]>;
  read(name: string): Promise<string | null>;
  write(name: string, contents: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export function mapDisk(files: Map<string, string> = new Map()): MapDisk {
  const writes: string[] = [];
  return {
    files,
    writes,
    async list() {
      return [...files.keys()];
    },
    async read(name: string) {
      return files.get(name) ?? null;
    },
    async write(name: string, contents: string) {
      files.set(name, contents);
      writes.push(name);
    },
    async remove(name: string) {
      files.delete(name);
    },
  };
}
