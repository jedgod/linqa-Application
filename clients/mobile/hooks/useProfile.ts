// Shared store for the signed-in user's username and avatar, so the drawer and
// the account screen update together. It belongs to one account at a time.

import { useEffect, useSyncExternalStore } from 'react';
import { useAccounts } from '../account/AccountContext';
import { registerAccountScopeReset } from '../services/account-scope';
import { fetchProfile, getAuthToken, type Profile } from '../lib/profileApi';

type State = {
  profile: Profile | null;
  /** Headers for <Image source={{ uri, headers }}> since avatars need the JWT. */
  imageHeaders: Record<string, string> | undefined;
  loading: boolean;
  error: string | null;
};

const EMPTY: State = { profile: null, imageHeaders: undefined, loading: false, error: null };
let state: State = EMPTY;
let loadedFor: string | null = null;
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

// Switching or removing an account must never show the previous account's photo or name.
registerAccountScopeReset('profile', () => clearProfile());

export async function refreshProfile() {
  if (state.loading) return;
  setState({ loading: true, error: null });
  try {
    const [profile, token] = await Promise.all([fetchProfile(), getAuthToken()]);
    loadedFor = profile.id;
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
  loadedFor = null;
  state = EMPTY;
  listeners.forEach((l) => l());
}

export function useProfile() {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  const { active } = useAccounts();
  const userId = active?.userId ?? null;

  useEffect(() => {
    if (!userId) return;
    if (loadedFor !== userId && !state.loading) {
      if (loadedFor) clearProfile();
      void refreshProfile();
    }
  }, [userId]);

  return { ...snapshot, refresh: refreshProfile, setProfile };
}
