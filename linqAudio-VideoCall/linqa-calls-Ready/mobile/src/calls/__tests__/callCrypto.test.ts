// eslint-disable-next-line no-var
declare var Buffer: any; // jest runs in Node
import { LinqaCallCrypto } from '../crypto/LinqaCallCrypto';
import { generateDeviceKeys, JsCoreBinding } from '../crypto/jsCoreBinding';
import type { DevicePublicKeys, KeyDirectory } from '../crypto/linqaCore';
import { b64d, b64e, utf8 } from '../crypto/bytes';

function world() {
  const devs = {
    alicePhone: generateDeviceKeys('alice', 'phone'),
    aliceDesk: generateDeviceKeys('alice', 'desk'),
    bobPhone: generateDeviceKeys('bob', 'phone'),
    bobTablet: generateDeviceKeys('bob', 'tablet'),
    eve: generateDeviceKeys('eve', 'phone'),
  };
  const all: DevicePublicKeys[] = Object.values(devs).map((d) => d.publicKeys);
  const directory: KeyDirectory = {
    devices: async (u) => all.filter((d) => d.userId === u),
    device: async (u, d) => all.find((x) => x.userId === u && x.deviceId === d) ?? null,
  };
  const make = (k: keyof typeof devs) =>
    new LinqaCallCrypto(new JsCoreBinding(devs[k].secrets), directory, {
      userId: devs[k].publicKeys.userId,
      deviceId: devs[k].publicKeys.deviceId,
    });
  return {
    alice: make('alicePhone'),
    aliceDesk: make('aliceDesk'),
    bob: make('bobPhone'),
    bobTablet: make('bobTablet'),
    eve: make('eve'),
  };
}

const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');

describe('LinqaCallCrypto', () => {
  it('seals the call key to every device of the callee, and signaling round-trips', async () => {
    const w = world();
    const keyId = await w.alice.createCallKey();
    const envs = await w.alice.envelopesFor(keyId, ['bob']);
    expect(envs.map((e) => e.deviceId).sort()).toEqual(['phone', 'tablet']);

    for (const e of envs) {
      const dev = e.deviceId === 'phone' ? w.bob : w.bobTablet;
      await dev.acceptEnvelope(keyId, 'alice', 'phone', e.envelope);
    }
    const wire = await w.alice.encrypt(keyId, utf8('{"desc":"offer"}'));
    const out = await w.bob.decrypt(keyId, wire);
    expect(out).toMatchObject({ senderUserId: 'alice', senderDeviceId: 'phone' });
    expect(text(out.plaintext)).toBe('{"desc":"offer"}');
    expect(await w.alice.verificationCode(keyId)).toBe(await w.bob.verificationCode(keyId));
    expect(await w.alice.verificationCode(keyId)).toMatch(/^\d{4} \d{4} \d{4}$/);
  });

  it('an envelope only opens on the device it was sealed to', async () => {
    const w = world();
    const keyId = await w.alice.createCallKey();
    const [toBobPhone] = (await w.alice.envelopesFor(keyId, ['bob'])).filter((e) => e.deviceId === 'phone');
    await expect(w.bobTablet.acceptEnvelope(keyId, 'alice', 'phone', toBobPhone.envelope)).rejects.toThrow();
    await expect(w.eve.acceptEnvelope(keyId, 'alice', 'phone', toBobPhone.envelope)).rejects.toThrow();
  });

  it('rejects an envelope when the server lies about who sent it, or for another call', async () => {
    const w = world();
    const keyId = await w.alice.createCallKey();
    const [env] = (await w.alice.envelopesFor(keyId, ['bob'])).filter((e) => e.deviceId === 'phone');
    await expect(w.bob.acceptEnvelope(keyId, 'eve', 'phone', env.envelope)).rejects.toThrow('envelope-wrong-sender');
    await expect(w.bob.acceptEnvelope('other-call', 'alice', 'phone', env.envelope)).rejects.toThrow();
  });

  it('a participant cannot sign signaling as someone else', async () => {
    const w = world();
    const keyId = await w.alice.createCallKey();
    for (const e of await w.alice.envelopesFor(keyId, ['bob', 'eve'])) {
      const dev = e.userId === 'eve' ? w.eve : e.deviceId === 'phone' ? w.bob : w.bobTablet;
      await dev.acceptEnvelope(keyId, 'alice', 'phone', e.envelope);
    }
    // Eve has the call key and forges a header claiming to be Alice.
    const real = JSON.parse(text(b64d(await w.eve.encrypt(keyId, utf8('evil')))));
    real.h.u = 'alice';
    await expect(w.bob.decrypt(keyId, b64e(utf8(JSON.stringify(real))))).rejects.toThrow('signal-bad-signature');
  });

  it('detects tampering and replays', async () => {
    const w = world();
    const keyId = await w.alice.createCallKey();
    const [env] = (await w.alice.envelopesFor(keyId, ['bob'])).filter((e) => e.deviceId === 'phone');
    await w.bob.acceptEnvelope(keyId, 'alice', 'phone', env.envelope);

    const wire = await w.alice.encrypt(keyId, utf8('hello'));
    await w.bob.decrypt(keyId, wire);
    await expect(w.bob.decrypt(keyId, wire)).rejects.toThrow('signal-replay');

    const msg = JSON.parse(text(b64d(await w.alice.encrypt(keyId, utf8('hello')))));
    const ct = b64d(msg.c);
    ct[0] ^= 1;
    msg.c = b64e(ct);
    await expect(w.bob.decrypt(keyId, b64e(utf8(JSON.stringify(msg))))).rejects.toThrow();
  });

  it('switch device: your other device gets the same key', async () => {
    const w = world();
    const keyId = await w.alice.createCallKey();
    const env = await w.alice.envelopeForOwnDevice(keyId, 'desk');
    await w.aliceDesk.acceptEnvelope(keyId, 'alice', 'phone', env);
    expect(await w.aliceDesk.verificationCode(keyId)).toBe(await w.alice.verificationCode(keyId));
  });

  it('forget wipes the key', async () => {
    const w = world();
    const keyId = await w.alice.createCallKey();
    await w.alice.forget(keyId);
    expect(w.alice.hasKey(keyId)).toBe(false);
    await expect(w.alice.encrypt(keyId, utf8('x'))).rejects.toThrow('no-call-key');
  });

  it('base64 helpers match Node for random data', () => {
    for (let n = 0; n < 40; n++) {
      const b = new Uint8Array(n).map(() => Math.floor(Math.random() * 256));
      expect(b64e(b)).toBe(Buffer.from(b).toString('base64'));
      expect(Buffer.from(b64d(b64e(b))).equals(Buffer.from(b))).toBe(true);
    }
  });
});
