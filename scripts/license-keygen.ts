// Generates the license signing key pair (docs/platform/713): ECDSA P-256.
//
//   bun scripts/license-keygen.ts
//
// Prints the private JWK, which goes into the license-status function's secret
// (supabase secrets set LICENSE_SIGNING_KEY='<private JWK>'), and the public
// JWK, which goes into LICENSE_PUBLIC_KEY in src/platform/license/config.ts.
// Nothing is written to disk; keep the private key out of the repository.

const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;

const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
const { kty, crv, x, y } = publicJwk;

console.log("LICENSE_SIGNING_KEY (private, function secret):");
console.log(JSON.stringify(privateJwk));
console.log("");
console.log("LICENSE_PUBLIC_KEY (public, src/platform/license/config.ts):");
console.log(JSON.stringify({ kty, crv, x, y }));

export {};
