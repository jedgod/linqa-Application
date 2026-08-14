export interface TransparencyInclusionProof {
  algorithm: "SHA256_MERKLE_V1";
  sequence: string;
  leafIndex: number;
  treeSize: number;
  packageHashHex: string;
  rootHashBase64: string;
  siblingsBase64: string[];
  checkpointSignatureBase64: string;
}

const bytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const utf8 = (value: string) => new TextEncoder().encode(value);
const concat = (...values: Uint8Array[]) => {
  const output = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
  let offset = 0; for (const value of values) { output.set(value, offset); offset += value.length; }
  return output;
};
const owned = (value: Uint8Array) => { const copy = new Uint8Array(value.length); copy.set(value); return copy; };
const sha256 = async (value: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", owned(value)));
const hex = (value: Uint8Array) => [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function verifyTransparencyProof(input: {
  packageBytes: Uint8Array;
  proof: TransparencyInclusionProof;
  checkpointPublicKeyBase64: string;
}): Promise<void> {
  const { proof } = input;
  if (proof.algorithm !== "SHA256_MERKLE_V1" || proof.treeSize < 1 || proof.leafIndex < 0 || proof.leafIndex >= proof.treeSize) {
    throw new Error("TRANSPARENCY_PROOF_INVALID");
  }
  const packageHash = await sha256(input.packageBytes);
  if (hex(packageHash) !== proof.packageHashHex.toLowerCase()) throw new Error("TRANSPARENCY_PACKAGE_HASH_MISMATCH");
  let current = await sha256(concat(utf8("linqa:transparency-leaf:v1\0"), utf8(proof.sequence), packageHash));
  let index = proof.leafIndex;
  for (const encodedSibling of proof.siblingsBase64) {
    const sibling = bytes(encodedSibling);
    if (sibling.length !== 32) throw new Error("TRANSPARENCY_PROOF_INVALID");
    current = await sha256(concat(Uint8Array.of(1), ...(index % 2 === 0 ? [current, sibling] : [sibling, current])));
    index = Math.floor(index / 2);
  }
  const expectedRoot = bytes(proof.rootHashBase64);
  if (hex(current) !== hex(expectedRoot)) throw new Error("TRANSPARENCY_ROOT_MISMATCH");
  const size = new Uint8Array(8); new DataView(size.buffer).setBigUint64(0, BigInt(proof.treeSize));
  const checkpoint = concat(utf8("linqa:transparency-checkpoint:v1\0"), size, expectedRoot);
  const publicKey = await crypto.subtle.importKey("raw", owned(bytes(input.checkpointPublicKeyBase64)), { name: "Ed25519" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "Ed25519" }, publicKey, owned(bytes(proof.checkpointSignatureBase64)), owned(checkpoint));
  if (!valid) throw new Error("TRANSPARENCY_CHECKPOINT_SIGNATURE_INVALID");
}
