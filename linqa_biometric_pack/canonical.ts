import { createHash } from 'node:crypto';

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

export function resourceHash(resource: unknown): Buffer {
  return createHash('sha256').update(stable(resource)).digest();
}

export function signingPayload(input: {
  challengeId: string;
  challenge: string;
  purpose: string;
  resourceHashHex: string;
  userId: string;
  deviceId: string;
}): Buffer {
  return Buffer.from([
    'LINQA-BIOMETRIC-V1',
    input.challengeId,
    input.challenge,
    input.purpose,
    input.resourceHashHex,
    input.userId,
    input.deviceId,
  ].join('\n'), 'utf8');
}
