// @ts-nocheck -- Node crypto creates deterministic server-style checkpoint fixtures.
import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { verifyTransparencyProof } from "./TransparencyVerifier";

const b64=(value:Buffer)=>value.toString("base64");
describe("signed transparency inclusion",()=>{
  beforeAll(()=>vi.stubGlobal("crypto",webcrypto));
  afterAll(()=>vi.unstubAllGlobals());
  it("accepts a package-bound Merkle leaf and rejects package substitution",async()=>{
    const packageBytes=Buffer.from("canonical-signed-key-package"); const packageHash=createHash("sha256").update(packageBytes).digest();
    const sequence="42"; const root=createHash("sha256").update(Buffer.from("linqa:transparency-leaf:v1\0")).update(sequence).update(packageHash).digest();
    const size=Buffer.alloc(8);size.writeBigUInt64BE(1n); const checkpoint=Buffer.concat([Buffer.from("linqa:transparency-checkpoint:v1\0"),size,root]);
    const {privateKey,publicKey}=generateKeyPairSync("ed25519"); const jwk=publicKey.export({format:"jwk"});
    const proof={algorithm:"SHA256_MERKLE_V1" as const,sequence,leafIndex:0,treeSize:1,packageHashHex:packageHash.toString("hex"),rootHashBase64:b64(root),siblingsBase64:[],checkpointSignatureBase64:b64(sign(null,checkpoint,privateKey))};
    await expect(verifyTransparencyProof({packageBytes,proof,checkpointPublicKeyBase64:Buffer.from(jwk.x!,"base64url").toString("base64")})).resolves.toBeUndefined();
    await expect(verifyTransparencyProof({packageBytes:Buffer.from("substituted"),proof,checkpointPublicKeyBase64:Buffer.from(jwk.x!,"base64url").toString("base64")})).rejects.toThrow("TRANSPARENCY_PACKAGE_HASH_MISMATCH");
  });
});
