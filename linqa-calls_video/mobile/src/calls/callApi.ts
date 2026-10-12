import type { CallInfoRes, CreateReportBody, IceServer } from './protocol';
import type { CallSession } from './ports';
import { CallRequestError } from './signaling';

async function call<T>(session: CallSession, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${session.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await session.getToken()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let code = `http-${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.message === 'string') code = body.message;
    } catch {}
    throw new CallRequestError(code);
  }
  return (await res.json()) as T;
}

export const callApi = {
  info: (s: CallSession, callId: string) => call<CallInfoRes>(s, `/calls/${encodeURIComponent(callId)}`),
  report: (s: CallSession, callId: string, body: CreateReportBody) =>
    call<{ id: string }>(s, `/calls/${encodeURIComponent(callId)}/reports`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  iceServers: (s: CallSession) => call<{ iceServers: IceServer[] }>(s, '/calls/ice-servers'),
};

/* UTF-8 without relying on TextEncoder/TextDecoder being present in the JS engine. */
export function utf8Encode(s: string): Uint8Array {
  const bin = unescape(encodeURIComponent(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function utf8Decode(b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return decodeURIComponent(escape(bin));
}
