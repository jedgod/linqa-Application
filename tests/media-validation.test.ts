import assert from "node:assert/strict";
import test from "node:test";
import { assertMediaSignature } from "../clients/mobile/services/media-validation";
test("media signatures reject mislabeled files before capture or rendering", () => {
 assert.doesNotThrow(() => assertMediaSignature(new Uint8Array([255,216,255]), "image/jpeg"));
 assert.doesNotThrow(() => assertMediaSignature(Buffer.from("0000ftypqt  "), "video/quicktime"));
 assert.doesNotThrow(() => assertMediaSignature(Buffer.from("GIF89a"), "image/gif"));
 assert.throws(() => assertMediaSignature(Buffer.from("<html>"), "image/jpeg"));
 assert.throws(() => assertMediaSignature(new Uint8Array([255,216,255]), "video/mp4"));
});
