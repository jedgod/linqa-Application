// Shared store for the signed-in user's username and avatar, so the drawer,
// the account screen and the invite screen all update together.

import { useEffect, useSyncExternalStore } from 'react';
import { fetchProfile, getAuthToken, type Profile } from '../lib/profileApi';

type State = {
  profile: Profile | null;
  /** Headers for <Image source={{ uri, headers }}> since avatars need the JWT. */
  imageHeaders: Record<string, string> | undefined;
  loading: boolean;
  error: string | null;
};

let state: State = { profile: null, imageHeaders: undefined, loading: false, error: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshProfile() {
  if (state.loading) return;
  setState({ loading: true, error: null });
  try {
    const [profile, token] = await Promise.all([fetchProfile(), getAuthToken()]);
    setState({
      profile,
      imageHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
      loading: false,
    });
  } catch (e) {
    setState({ loading: false, error: e instanceof Error ? e.message : 'Could not load profile' });
  }
}

/** Replace the cached profile after a successful save. */
export function setProfile(profile: Profile) {
  setState({ profile });
}

/** Call on sign-out so the next account does not see the old profile. */
export function clearProfile() {
  setState({ profile: null, imageHeaders: undefined, error: null });
}

export function useProfile() {
  const snapshot = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    if (!state.profile && !state.loading) void refreshProfile();
  }, []);

  return { ...snapshot, refresh: refreshProfile, setProfile };
}
