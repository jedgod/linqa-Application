import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { STREAM_CHUNK_BYTES, STREAM_TAG_BYTES } from "../clients/mobile/services/stream-crypto.ts";
import { postStatusVideo, StatusVideoPostError, type PostInput, type ScratchFile, type SourceFile, type UploadApi, type UploadDeps } from "../clients/mobile/services/status-video-upload.ts";
import { openSealedRecording, openStatusVideo, StatusVideoViewError, type CipherFile, type FeedItem, type PlainSink, type ViewDeps } from "../clients/mobile/services/status-video-view.ts";
import { USER_A, USER_B, code, directoryOf, messaging, phone } from "./support/secure-core-fixtures.ts";

// End to end through the REAL encryption format and the REAL secure-core messaging code (only the native core, the file system and the
// server are stand-ins). The "server" below behaves like the real one in the ways that matter: it only ever holds ciphertext and
// opaque sealed bundles, and it hands a viewer exactly the bytes it was given, which tests below then corrupt on purpose.

const MIB = 1024 * 1024;
const rand = (n: number) => new Uint8Array(randomBytes(n));
const AUDIENCE = [USER_B];

const bufferSource = (data: Uint8Array, log: number[] = []): SourceFile => ({ size: data.length, read: (offset, length) => { log.push(length); return data.slice(offset, offset + length); } });

class MemScratch implements ScratchFile {
  chunks: Uint8Array[] = []; disposed = false; reads: number[] = []; failAfter = Infinity;
  append(bytes: Uint8Array) { if (this.chunks.length >= this.failAfter) throw new Error("ENOSPC"); this.chunks.push(bytes.slice()); }
  read(offset: number, length: number) {
    this.reads.push(length);
    const all = Buffer.concat(this.chunks); return new Uint8Array(all.subarray(offset, offset + length));
  }
  dispose() { this.disposed = true; }
}

class FakeServer {
  uploads = new Map<string, { chunkCount: number; ciphertextSize: number; manifest: string; parts: Map<number, Uint8Array>; done: boolean }>();
  posts: Array<{ id: string; attachmentId: string; ownerUserId: string; kind: "VIDEO" | "PODCAST"; durationSeconds: number; ciphertextSize: number; recipients: Array<{ userId: string; deviceId: string; sealedKey: string }> }> = [];
  stored = new Map<string, Uint8Array>();
  failPut: (partNumber: number, attempt: number) => boolean = () => false;
  attempts = new Map<number, number>();
  signCalls = 0;
  aborted: string[] = [];
  failAbort = false;
  purposesSeen: unknown[] = [];
  seen: string[] = []; // everything the server was ever sent, as text, to prove it never sees a key or plaintext

  api(owner: string): UploadApi {
    return {
      createUpload: async (i) => {
        this.seen.push(JSON.stringify(i));
        const attachmentId = randomUUID(), uploadId = "up-" + attachmentId;
        this.uploads.set(attachmentId, { chunkCount: i.chunkCount, ciphertextSize: i.ciphertextSize, manifest: i.manifestHashBase64, parts: new Map(), done: false });
        return { attachmentId, uploadId };
      },
      signPart: async (attachmentId, _u, n) => { this.signCalls++; return { url: `mem://${attachmentId}/${n}` }; },
      putPart: async (url, bytes) => {
        const [, , attachmentId, n] = url.split("/"); const part = Number(n);
        const attempt = (this.attempts.get(part) ?? 0) + 1; this.attempts.set(part, attempt);
        if (this.failPut(part, attempt)) throw new Error("network down");
        this.uploads.get(attachmentId!)!.parts.set(part, bytes.slice());
        return { etag: `"etag-${part}"` };
      },
      complete: async (attachmentId, _u, parts) => {
        const u = this.uploads.get(attachmentId)!;
        assert.equal(parts.length, u.chunkCount, "every part must be sent");
        const joined = Buffer.concat(parts.sort((a, b) => a.partNumber - b.partNumber).map((p) => u.parts.get(p.partNumber)!));
        assert.equal(joined.length, u.ciphertextSize, "the stored object must be exactly the declared size");
        this.stored.set(attachmentId, new Uint8Array(joined)); u.done = true;
      },
      abort: async (attachmentId) => {
        if (this.failAbort) throw new Error("storage down");
        this.aborted.push(attachmentId);
        this.uploads.delete(attachmentId);
      },
      createPost: async (body) => {
        this.seen.push(JSON.stringify(body));
        assert.ok(this.uploads.get(body.attachmentId)?.done, "a post needs a completed upload");
        const id = randomUUID();
        this.posts.push({ id, attachmentId: body.attachmentId, ownerUserId: owner, kind: body.kind, durationSeconds: body.durationSeconds, ciphertextSize: body.ciphertextSize, recipients: body.recipients });
        return { id, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), deliveredToDevices: body.recipients.length };
      }
    };
  }
  feedFor(deviceId: string): FeedItem[] {
    return this.posts.flatMap((p) => { const r = p.recipients.find((x) => x.deviceId === deviceId); return r ? [{ id: p.id, attachmentId: p.attachmentId, ownerUserId: p.ownerUserId, kind: p.kind, durationSeconds: p.durationSeconds, ciphertextSize: p.ciphertextSize, createdAt: "", expiresAt: "", sealedKey: r.sealedKey, viewedAt: null }] : []; });
  }
}

class MemSink implements PlainSink {
  parts: Uint8Array[] = []; finished = false; disposed = false; failAfter = Infinity;
  append(b: Uint8Array) { if (this.parts.length >= this.failAfter) throw new Error("ENOSPC"); this.parts.push(b.slice()); }
  finish() { this.finished = true; return "file:///cache/plain.mp4"; }
  dispose() { this.disposed = true; }
  bytes() { return new Uint8Array(Buffer.concat(this.parts)); }
}

function world() {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  return { alice, bob };
}
async function setup(sourceSize = 11 * MIB + 123) {
  const { alice, bob } = world();
  const directory = await directoryOf([alice, bob]);
  const server = new FakeServer();
  const data = rand(sourceSize);
  const scratch = new MemScratch();
  const sourceReads: number[] = [];
  const deps: UploadDeps = {
    random: rand, uuid: randomUUID, api: server.api(USER_A), sealer: messaging(alice, directory), scratch: () => scratch, sleep: async () => {}
  };
  const input: PostInput = { source: bufferSource(data, sourceReads), mime: "video/mp4", durationSeconds: 900, kind: "PODCAST", ownerUserId: USER_A, audienceUserIds: AUDIENCE };
  return { alice, bob, directory, server, data, scratch, sourceReads, deps, input };
}
// The app keeps ONE messaging session per account (services/shared-secure-session.ts), which remembers what it has opened because
// the core refuses to open the same envelope twice. Tests that watch the same post repeatedly must do the same.
const sessions = new WeakMap<object, ReturnType<typeof messaging>>();
const sessionOf = (p: ReturnType<typeof phone>, directory: Awaited<ReturnType<typeof directoryOf>>) => {
  let m = sessions.get(p); if (!m) { m = messaging(p, directory); sessions.set(p, m); } return m;
};
function viewer(server: FakeServer, p: ReturnType<typeof phone>, directory: Awaited<ReturnType<typeof directoryOf>>, sink = new MemSink(), tamper?: (stored: Uint8Array) => Uint8Array): { deps: ViewDeps; sink: MemSink; disposedCipher: () => boolean } {
  let disposed = false;
  const m = sessionOf(p, directory);
  return {
    sink, disposedCipher: () => disposed,
    deps: {
      open: (sealed, ctx) => m.open(sealed, ctx),
      api: {
        download: async (postId) => { const post = server.posts.find((x) => x.id === postId)!; const bytes = server.stored.get(post.attachmentId)!; return { url: `mem://${post.attachmentId}`, ciphertextSize: post.ciphertextSize ?? bytes.length }; },
        markViewed: async () => {}
      },
      fetchCipher: async (url) => {
        const bytes = (tamper ?? ((b) => b))(server.stored.get(url.replace("mem://", ""))!);
        const f: CipherFile = { size: bytes.length, read: (o, l) => bytes.slice(o, o + l), dispose: () => { disposed = true; } };
        return f;
      },
      plainSink: () => sink
    }
  };
}

test("a recording goes up encrypted and the chosen friend, and the owner, get the original bytes back", async () => {
  const s = await setup();
  const progress: Array<[string, number]> = [];
  const posted = await postStatusVideo(s.input, s.deps, (p) => progress.push([p.phase, p.fraction]));
  assert.equal(posted.deliveredToDevices, 2, "bob's phone and alice's own phone");
  assert.equal(s.server.posts.length, 1);

  const bobFeed = s.server.feedFor(s.bob.deviceId);
  assert.equal(bobFeed.length, 1);
  const v = viewer(s.server, s.bob, s.directory);
  const opened = await openStatusVideo(bobFeed[0]!, v.deps);
  assert.deepEqual(opened, { uri: "file:///cache/plain.mp4", mime: "video/mp4", durationSeconds: 900, kind: "PODCAST" });
  assert.deepEqual(v.sink.bytes(), s.data, "bob sees exactly what alice recorded");
  assert.ok(v.sink.finished && !v.sink.disposed);
  assert.ok(v.disposedCipher(), "the downloaded ciphertext is deleted after decrypting");

  const mine = viewer(s.server, s.alice, s.directory);
  await openStatusVideo(s.server.feedFor(s.alice.deviceId)[0]!, mine.deps);
  assert.deepEqual(mine.sink.bytes(), s.data, "the owner can watch it back");

  // progress runs through every phase in order, and each phase ends at 1
  const phases = [...new Set(progress.map((p) => p[0]))];
  assert.deepEqual(phases, ["encrypting", "uploading", "sealing", "posting"]);
  for (const ph of ["encrypting", "uploading"]) {
    const f = progress.filter((p) => p[0] === ph).map((p) => p[1]);
    assert.deepEqual(f, [...f].sort((a, b) => a - b)); assert.equal(f.at(-1), 1);
  }
  assert.ok(s.scratch.disposed, "the scratch ciphertext file is always deleted");
});

test("the server only ever sees ciphertext and opaque bundles, and the phone never holds more than one chunk at a time", async () => {
  const s = await setup();
  await postStatusVideo(s.input, s.deps);
  const stored = s.server.stored.values().next().value as Uint8Array;
  assert.notDeepEqual(stored.subarray(0, 4096), s.data.subarray(0, 4096));
  assert.equal(stored.length, s.data.length + 3 * STREAM_TAG_BYTES);
  // no 32-byte run of the plaintext appears anywhere in the ciphertext
  assert.equal(Buffer.from(stored).includes(Buffer.from(s.data.subarray(1000, 1032))), false);
  // nothing the server was sent contains the key material: a sealed bundle is opaque and the request bodies hold no key fields
  const sentToServer = s.server.seen.join("\n");
  assert.doesNotMatch(sentToServer, /"key"|noncePrefix|mediaId/);
  assert.ok(Math.max(...s.sourceReads) <= STREAM_CHUNK_BYTES, "source is read one chunk at a time");
  assert.ok(Math.max(...s.scratch.reads) <= STREAM_CHUNK_BYTES + STREAM_TAG_BYTES, "parts are read one chunk at a time");
});

test("someone who was not chosen cannot open the key, even holding the sealed bundle", async () => {
  const s = await setup();
  await postStatusVideo(s.input, s.deps);
  const item = s.server.feedFor(s.bob.deviceId)[0]!;
  const carol = phone("00000000-0000-4000-8000-0000000000d4", "10000000-0000-4000-8000-0000000000d4", 9);
  const dir = await directoryOf([s.alice, s.bob, carol]);
  const v = viewer(s.server, carol, dir);
  await assert.rejects(() => openStatusVideo(item, v.deps), (e: unknown) => e instanceof StatusVideoViewError && e.code === "BUNDLE_INVALID");
  assert.equal(carol.core.decrypts, 0);
});

test("a malicious server that alters, reorders, truncates or extends the ciphertext is caught, and nothing readable is left behind", async () => {
  const s = await setup();
  await postStatusVideo(s.input, s.deps);
  const item = s.server.feedFor(s.bob.deviceId)[0]!;
  const CT = STREAM_CHUNK_BYTES + STREAM_TAG_BYTES;
  const attempts: Array<[string, (b: Uint8Array) => Uint8Array, string]> = [
    ["flip a byte in the middle chunk", (b) => { const c = b.slice(); c[CT + 1000] ^= 1; return c; }, "CORRUPT"],
    ["flip a byte in the last chunk", (b) => { const c = b.slice(); c[c.length - 3] ^= 1; return c; }, "CORRUPT"],
    ["swap the first two chunks", (b) => { const c = b.slice(); c.set(b.subarray(CT, 2 * CT), 0); c.set(b.subarray(0, CT), CT); return c; }, "CORRUPT"],
    ["drop the last chunk", (b) => b.slice(0, 2 * CT), "SIZE_MISMATCH"],
    ["append junk", (b) => { const c = new Uint8Array(b.length + 100); c.set(b); return c; }, "SIZE_MISMATCH"]
  ];
  for (const [name, tamper, expected] of attempts) {
    const v = viewer(s.server, s.bob, s.directory, new MemSink(), tamper);
    await assert.rejects(() => openStatusVideo(item, v.deps), (e: unknown) => e instanceof StatusVideoViewError && e.code === expected, name);
    assert.ok(!v.sink.finished, `${name}: nothing is handed to the player`);
    assert.ok(v.sink.disposed || v.sink.parts.length === 0, `${name}: partly decrypted output is deleted`);
    assert.ok(v.disposedCipher(), `${name}: the downloaded file is deleted`);
  }
});

test("a server cannot attach a bundle to a different upload, change the declared size, or lie about the owner", async () => {
  const s = await setup();
  await postStatusVideo(s.input, s.deps);
  const item = s.server.feedFor(s.bob.deviceId)[0]!;
  const open = messaging(s.bob, s.directory).open.bind(messaging(s.bob, s.directory));
  const fresh = () => messaging(phone(USER_B, s.bob.deviceId, 3), s.directory);
  await assert.rejects(() => openSealedRecording({ ...item, attachmentId: randomUUID() }, (a, c) => fresh().open(a, c)), (e: unknown) => (e as StatusVideoViewError).code === "BUNDLE_INVALID");
  await assert.rejects(() => openSealedRecording({ ...item, ciphertextSize: item.ciphertextSize + 1 }, (a, c) => fresh().open(a, c)), (e: unknown) => (e as StatusVideoViewError).code === "SIZE_MISMATCH");
  await assert.rejects(() => openSealedRecording({ ...item, ownerUserId: USER_B }, (a, c) => fresh().open(a, c)), (e: unknown) => (e as StatusVideoViewError).code === "BUNDLE_INVALID");
  void open;
});

test("a part that fails is retried on its own with a fresh signed link; three failures end the post and clean up", async () => {
  const s = await setup();
  s.server.failPut = (part, attempt) => part === 2 && attempt < 3;       // part 2 fails twice, then works
  await postStatusVideo(s.input, s.deps);
  assert.equal(s.server.attempts.get(2), 3);
  assert.equal(s.server.attempts.get(1), 1, "other parts are not re-sent");
  assert.equal(s.server.signCalls, 3 + 2, "a fresh link per attempt: 3 parts + 2 retries");

  const t = await setup();
  t.server.failPut = (part) => part === 1;
  await assert.rejects(() => postStatusVideo(t.input, t.deps), (e: unknown) => e instanceof StatusVideoPostError && e.code === "UPLOAD_FAILED");
  assert.equal(t.server.posts.length, 0, "no post for an upload that never finished");
  assert.ok(t.scratch.disposed);
});

test("if the server cannot create the upload, nothing is sent, nothing is posted, and the scratch file is deleted", async () => {
  const s = await setup();
  s.deps.api.createUpload = async () => { throw new Error("HTTP_400"); };
  await assert.rejects(() => postStatusVideo(s.input, s.deps), (e: unknown) => e instanceof StatusVideoPostError && e.code === "UPLOAD_FAILED");
  assert.equal(s.server.posts.length, 0);
  assert.ok(s.scratch.disposed);
});

test("cancelling mid-upload frees the stored parts: the server is told to abort exactly that upload", async () => {
  const s = await setup();
  const signal = { aborted: false };
  const created: string[] = [];
  const real = s.deps.api.createUpload.bind(s.deps.api);
  s.deps.api.createUpload = async (i) => { const r = await real(i); created.push(r.attachmentId); return r; };
  await assert.rejects(() => postStatusVideo(s.input, s.deps, (p) => { if (p.phase === "uploading" && p.fraction >= 0.5) signal.aborted = true; }, signal),
    (e: unknown) => e instanceof StatusVideoPostError && e.code === "CANCELLED");
  assert.deepEqual(s.server.aborted, created, "one upload was open and exactly that one was aborted");
  assert.equal(s.server.posts.length, 0);
});

test("a failed upload (every retry used up) aborts too, and a failing abort never hides the real error", async () => {
  const s = await setup();
  s.server.failPut = (part) => part === 2;
  s.server.failAbort = true;
  await assert.rejects(() => postStatusVideo(s.input, s.deps), (e: unknown) => e instanceof StatusVideoPostError && e.code === "UPLOAD_FAILED");
  const t = await setup();
  t.server.failPut = (part) => part === 2;
  await assert.rejects(() => postStatusVideo(t.input, t.deps), (e: unknown) => e instanceof StatusVideoPostError && e.code === "UPLOAD_FAILED");
  assert.equal(t.server.aborted.length, 1);
});

test("nothing is aborted when nothing was created (cancel while encrypting, or the upload could not be started)", async () => {
  const early = await setup();
  const signal = { aborted: false };
  await assert.rejects(() => postStatusVideo(early.input, early.deps, (p) => { if (p.phase === "encrypting") signal.aborted = true; }, signal), (e: unknown) => (e as StatusVideoPostError).code === "CANCELLED");
  assert.deepEqual(early.server.aborted, []);
  const refused = await setup();
  refused.deps.api.createUpload = async () => { throw new Error("HTTP_400"); };
  await assert.rejects(() => postStatusVideo(refused.input, refused.deps), (e: unknown) => (e as StatusVideoPostError).code === "UPLOAD_FAILED");
  assert.deepEqual(refused.server.aborted, []);
});

test("once the upload has completed it is never aborted (the server's orphan cleanup owns it if the post fails)", async () => {
  const s = await setup();
  s.deps.api.createPost = async () => { throw new Error("HTTP_422"); };
  await assert.rejects(() => postStatusVideo(s.input, s.deps), (e: unknown) => e instanceof StatusVideoPostError && e.code === "POST_REJECTED");
  assert.deepEqual(s.server.aborted, []);
  assert.equal([...s.server.uploads.values()].filter((u) => u.done).length, 1, "the finished upload is left for the server to clean up");
});

test("cancelling stops the work, posts nothing and deletes the scratch file", async () => {
  const s = await setup();
  const signal = { aborted: false };
  await assert.rejects(() => postStatusVideo(s.input, s.deps, (p) => { if (p.phase === "uploading" && p.fraction >= 0.5) signal.aborted = true; }, signal),
    (e: unknown) => e instanceof StatusVideoPostError && e.code === "CANCELLED");
  assert.equal(s.server.posts.length, 0);
  assert.ok(s.scratch.disposed);
});

test("bad requests are refused before anything is read, encrypted or sent", async () => {
  const s = await setup(MIB);
  const run = (over: Partial<PostInput>) => code2(postStatusVideo({ ...s.input, ...over }, s.deps));
  assert.equal(await run({ durationSeconds: 1801 }), "TOO_LONG");
  assert.equal(await run({ durationSeconds: 0 }), "EMPTY");
  assert.equal(await run({ audienceUserIds: [] }), "NO_AUDIENCE");
  assert.equal(await run({ audienceUserIds: [USER_A] }), "NO_AUDIENCE", "only the owner is not an audience");
  assert.equal(await run({ source: { size: 0, read: () => new Uint8Array() } }), "EMPTY");
  assert.equal(await run({ source: { size: 501 * MIB, read: () => { throw new Error("must not read"); } } }), "TOO_LARGE");
  assert.equal(await run({ durationSeconds: 1800 }), "OK", "exactly 30 minutes is allowed");
  assert.equal(s.server.uploads.size, 1);
});

test("running out of phone storage while encrypting is reported plainly and cleans up", async () => {
  const s = await setup();
  s.scratch.failAfter = 1;
  await assert.rejects(() => postStatusVideo(s.input, s.deps), (e: unknown) => e instanceof StatusVideoPostError && e.code === "STORAGE_FULL");
  assert.equal(s.server.uploads.size, 0, "nothing was uploaded");
  assert.ok(s.scratch.disposed);
});

test("viewing: running out of storage while decrypting is reported and the partial file is deleted", async () => {
  const s = await setup();
  await postStatusVideo(s.input, s.deps);
  const sink = new MemSink(); sink.failAfter = 1;
  const v = viewer(s.server, s.bob, s.directory, sink);
  await assert.rejects(() => openStatusVideo(s.server.feedFor(s.bob.deviceId)[0]!, v.deps), (e: unknown) => (e as StatusVideoViewError).code === "STORAGE_FULL");
  assert.ok(sink.disposed && !sink.finished);
});

async function code2(p: Promise<unknown>) { try { await p; return "OK"; } catch (e) { return e instanceof StatusVideoPostError ? e.code : `OTHER:${(e as Error).message}`; } }
void code;
