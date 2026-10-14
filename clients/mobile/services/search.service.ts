import { getApiBaseUrl } from '../config/api';
import { accessTokenProvider } from './session';
import { accountScopeGeneration } from './account-scope';

export type SearchChat = { conversationId: string; title: string; isGroup: boolean; archived: boolean; unreadCount: number; peerUserId: string | null; updatedAt: string | null };
export type SearchPerson = { userId: string; displayName: string; username: string | null };
export type SearchResults = { query: string; chats: SearchChat[]; people: SearchPerson[]; nextOffset: number | null };
export async function searchLinqa(query: string, kind: 'all' | 'chats' | 'people', offset = 0, signal?: AbortSignal): Promise<SearchResults> {
  const generation = accountScopeGeneration();
  const token = await accessTokenProvider.getAccessToken();
  if (generation !== accountScopeGeneration()) throw new Error('Account changed');
  const response = await fetch(`${getApiBaseUrl()}/v1/search?q=${encodeURIComponent(query)}&kind=${kind}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${token}` }, signal,
  });
  const body = await response.json();
  if (generation !== accountScopeGeneration()) throw new Error('Account changed');
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'Unable to search. Try again.');
  return body as SearchResults;
}
