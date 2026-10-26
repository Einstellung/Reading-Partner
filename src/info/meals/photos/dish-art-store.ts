// The library's dish pictures on this device (docs/671 菜品图): read from
// meals-art/<tag>/ when they are there, downloaded from the release the first
// time a meal shows one. A file under a tag never changes, so one on disk is
// never checked again. Machine-local: every device downloads its own
// (palace/kinds.ts `meals-art`).
//
// The download goes through the Tauri http plugin, the path the app's other
// binary downloads take, so the webview's CORS and CSP never see it; outside
// Tauri (bun dev) it is the plain fetch.

import { appData } from "../../../platform/app/appdata";
import { isTauri } from "../../../platform/app/host";
import { cleanTauriFetch } from "../../../platform/app/tauri-fetch";
import { bytesToBase64 } from "../../../platform/std/base64";
import { dishArtDir, dishArtPath, dishArtUrl } from "./dish-art";

export interface DishArtIo {
  exists(path: string): Promise<boolean>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  mkdirp(path: string): Promise<void>;
}

export interface DishArtPorts {
  io: DishArtIo;
  /** The bytes at a URL, or null when the server answered anything but OK. Throws when it could not be reached. */
  fetchBytes(url: string): Promise<Uint8Array | null>;
}

export interface DishArtStore {
  /** The pictures already on disk, as data: URIs by id. */
  cached(ids: readonly string[]): Promise<Record<string, string>>;
  /**
   * Download these pictures, which `cached` did not find, and keep them,
   * answering the ones that landed. A picture the release does not have is not asked for again this
   * session; one that could not be reached is asked for at the next call.
   */
  download(ids: readonly string[]): Promise<Record<string, string>>;
}

const src = (bytes: Uint8Array) => `data:image/webp;base64,${bytesToBase64(bytes)}`;

export function createDishArtStore(ports: DishArtPorts): DishArtStore {
  const { io } = ports;
  const absent = new Set<string>();
  // One download per picture, however many reloads ask for it meanwhile.
  const inflight = new Map<string, Promise<Uint8Array | null>>();

  async function onDisk(id: string): Promise<Uint8Array | null> {
    const path = dishArtPath(id);
    return (await io.exists(path)) ? io.readBytes(path) : null;
  }

  async function fetchOne(id: string): Promise<Uint8Array | null> {
    const bytes = await ports.fetchBytes(dishArtUrl(id));
    if (!bytes) {
      absent.add(id);
      return null;
    }
    await io.mkdirp(dishArtDir());
    await io.writeBytes(dishArtPath(id), bytes);
    return bytes;
  }

  function downloadOne(id: string): Promise<Uint8Array | null> {
    let pending = inflight.get(id);
    if (!pending) {
      pending = fetchOne(id)
        .catch(() => null)
        .finally(() => inflight.delete(id));
      inflight.set(id, pending);
    }
    return pending;
  }

  async function collect(
    ids: readonly string[],
    read: (id: string) => Promise<Uint8Array | null>,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const bytes = await read(id);
        if (bytes) out[id] = src(bytes);
      }),
    );
    return out;
  }

  return {
    cached: (ids) => collect(ids, onDisk),
    download: (ids) => collect(ids, async (id) => (absent.has(id) ? null : downloadOne(id))),
  };
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const res = isTauri() ? await cleanTauriFetch(url) : await fetch(url);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

let live: DishArtStore | null = null;

/** This device's store. One, so a picture is downloaded once however many screens ask. */
export function dishArtStore(): DishArtStore {
  live ??= createDishArtStore({ io: appData, fetchBytes });
  return live;
}
