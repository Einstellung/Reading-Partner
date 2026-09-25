// Bytes to and from bare base64 (no `data:` prefix; a caller that wants a data
// URL adds or strips it itself). Standard alphabet, padded.

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // In chunks: String.fromCharCode spread over a multi-megabyte array overflows
  // the argument list.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Throws on input that is not base64, as atob does. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
