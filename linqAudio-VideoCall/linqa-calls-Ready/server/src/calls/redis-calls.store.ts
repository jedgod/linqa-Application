/**
 * Redis-backed call store. Same methods as CallsStore.
 * Use this when more than one API instance handles calls.
 * Also enable the socket.io Redis adapter so emits reach every node.
 *
 * npm i ioredis
 * REDIS_URL=redis://127.0.0.1:6379
 */
import Redis from 'ioredis';
import { CallRecord, HandoffRecord } from './calls.store';

const CALL_PREFIX = 'linqa:call:';
const HANDOFF_PREFIX = 'linqa:handoff:';

export class RedisCallsStore {
  constructor(private readonly redis: Redis) {}

  async get(callId: string): Promise<CallRecord | undefined> {
    const raw = await this.redis.get(CALL_PREFIX + callId);
    return raw ? hydrateCall(JSON.parse(raw)) : undefined;
  }

  async put(call: CallRecord): Promise<void> {
    await this.redis.set(CALL_PREFIX + call.callId, JSON.stringify(dehydrateCall(call)), 'EX', 60 * 60 * 6);
  }

  async delete(callId: string): Promise<void> {
    await this.redis.del(CALL_PREFIX + callId);
  }

  async putHandoff(h: HandoffRecord): Promise<void> {
    const ttl = Math.max(1, Math.ceil((h.expiresAt - Date.now()) / 1000));
    await this.redis.set(HANDOFF_PREFIX + h.token, JSON.stringify(h), 'EX', ttl);
  }

  async getHandoff(token: string): Promise<HandoffRecord | undefined> {
    const raw = await this.redis.get(HANDOFF_PREFIX + token);
    return raw ? JSON.parse(raw) : undefined;
  }

  async deleteHandoff(token: string): Promise<void> {
    await this.redis.del(HANDOFF_PREFIX + token);
  }
}

function dehydrateCall(call: CallRecord) {
  return {
    ...call,
    participants: [...call.participants.entries()],
    invited: [...call.invited],
    everJoined: [...call.everJoined],
    everInvited: [...call.everInvited],
    envelopes: [...call.envelopes.entries()],
  };
}

function hydrateCall(raw: any): CallRecord {
  return {
    ...raw,
    participants: new Map(raw.participants),
    invited: new Set(raw.invited),
    everJoined: new Set(raw.everJoined),
    everInvited: new Set(raw.everInvited),
    envelopes: new Map(raw.envelopes),
  };
}
