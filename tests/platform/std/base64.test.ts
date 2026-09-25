import { describe, expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "../../../src/platform/std/base64";

function pattern(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) & 0xff;
  return bytes;
}

describe("bytesToBase64", () => {
  test("encodes with padding", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
    expect(bytesToBase64(new TextEncoder().encode("f"))).toBe("Zg==");
    expect(bytesToBase64(new TextEncoder().encode("fo"))).toBe("Zm8=");
    expect(bytesToBase64(new TextEncoder().encode("foo"))).toBe("Zm9v");
  });

  test("covers every byte value", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(bytesToBase64(all)).toBe(Buffer.from(all).toString("base64"));
  });

  test("encodes an input far past one chunk without overflowing the stack", () => {
    // 8 MB: a single fromCharCode spread over this throws a RangeError.
    const big = pattern(8 * 1024 * 1024 + 5);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });

  test("chunk boundaries do not shift the output", () => {
    for (const n of [0x8000 - 1, 0x8000, 0x8000 + 1, 0x8000 * 3 + 2]) {
      const bytes = pattern(n);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });
});

describe("base64ToBytes", () => {
  test("decodes", () => {
    expect(base64ToBytes("Zm9v")).toEqual(new TextEncoder().encode("foo"));
    expect(base64ToBytes("Zg==")).toEqual(new TextEncoder().encode("f"));
    expect(base64ToBytes("")).toEqual(new Uint8Array([]));
  });

  test("round-trips a large input", () => {
    const big = pattern(8 * 1024 * 1024 + 5);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });

  test("throws on input that is not base64", () => {
    expect(() => base64ToBytes("not base64!")).toThrow();
  });
});
