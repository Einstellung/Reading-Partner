// The speaking key's path from Settings to the plugin (docs/33): the credential
// it is saved as, the command that carries it, and what happens when it is not
// there. Run: bash scripts/t.sh tests/ai/voice/speech-key.test.ts
//
// The fallback to MIMO_API_KEY is the native side's decision and is tested
// there (plugins/voice/src/session.rs). What this file pins is the half a
// webview owns: `null` for "nothing saved" reaches the command, so the plugin
// gets the chance to fall back at all.
//
// Every key-shaped string below is fake. Nothing here reaches a vendor.

import { beforeEach, expect, test } from "bun:test";
import {
  SPEECH_KEY_COMMAND,
  getTtsKey,
  hasTtsKey,
  pushSpeechKey,
  setTtsKey,
  syncSpeechKey,
  type SpeechKeyBridge,
} from "../../../src/ai/voice/speech-key";
import { loadCredentials, setActiveCredential } from "../../../src/ai/credentials";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

const FILE = "credentials.json";
const KEY = "tts-key-not-real";

let disk: FakeDisk;

// What the plugin was handed, in order.
let sent: Array<Record<string, unknown> | undefined>;
let answer: boolean;

const bridge: SpeechKeyBridge = {
  invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    expect(command).toBe(SPEECH_KEY_COMMAND);
    sent.push(args);
    return answer as T;
  },
};

beforeEach(() => {
  disk = installAppData();
  sent = [];
  answer = true;
});

function stored(): Record<string, { type: string; key: string }> {
  return JSON.parse(disk.files.get(FILE) ?? "{}");
}

test("a saved key lands in credentials.json as an apiKey credential", async () => {
  await setTtsKey(KEY);
  expect(stored().voiceTts).toEqual({ type: "apiKey", key: KEY });
  expect(await getTtsKey()).toBe(KEY);
  expect(await hasTtsKey()).toBe(true);
});

test("a saved key is trimmed, and a blank one clears it", async () => {
  await setTtsKey(`  ${KEY}\n`);
  expect(await getTtsKey()).toBe(KEY);

  await setTtsKey("   ");
  expect(stored().voiceTts).toBeUndefined();
  expect(await getTtsKey()).toBeNull();
  expect(await hasTtsKey()).toBe(false);
});

test("it is a device key: signing a provider in leaves it alone", async () => {
  await setTtsKey(KEY);
  await setActiveCredential("deepseek", { type: "apiKey", key: "dk-not-real" });

  const creds = await loadCredentials();
  expect(creds.voiceTts).toEqual({ type: "apiKey", key: KEY });
  expect(creds.deepseek).toEqual({ type: "apiKey", key: "dk-not-real" });
});

test("the handover sends the key under the argument name the command reads", async () => {
  expect(await pushSpeechKey(KEY, bridge)).toBe(true);
  expect(sent).toEqual([{ key: KEY }]);
});

test("with nothing saved the handover sends null, so the plugin can fall back", async () => {
  answer = false;
  expect(await syncSpeechKey(bridge)).toBe(false);
  // Not undefined and not omitted: an absent argument would leave the plugin's
  // key at whatever the last save put there.
  expect(sent).toEqual([{ key: null }]);
});

test("syncing sends whatever was last saved", async () => {
  await setTtsKey(KEY);
  expect(await syncSpeechKey(bridge)).toBe(true);
  expect(sent).toEqual([{ key: KEY }]);
});

test("a plugin that is not there does not reject the caller", async () => {
  const broken: SpeechKeyBridge = {
    invoke: () => Promise.reject(new Error("voice.set_speech_key not allowed")),
  };
  expect(await syncSpeechKey(broken)).toBe(false);
});

test("on a host that cannot speak there is nothing to hand it to", async () => {
  await setTtsKey(KEY);
  // No bridge, and bun is not a phone: hasNativeSpeech() is false, so the
  // command is never reached. On a desktop it would be refused by the ACL
  // anyway — the capability that grants the voice commands is iOS-only.
  expect(await syncSpeechKey()).toBe(false);
  expect(sent).toEqual([]);
});
