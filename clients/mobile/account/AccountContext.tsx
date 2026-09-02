import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { clearAccountScopedState } from "../services/account-scope";

export type LocalAccount = {
  userId: string;
  slot: 1 | 2 | 3;
  displayName: string;
  label?: string;
  phoneSuffix?: string;
  countryIso2?: string;
  avatarUri?: string;
};

type AccountContextValue = {
  active: LocalAccount | null;
  accounts: LocalAccount[];
  loaded: boolean;
  setAccounts(accounts: LocalAccount[]): void;
  activate(userId: string): void;
  addAndActivate(account: LocalAccount): void;
};

const Context = createContext<AccountContextValue | null>(null);

// Persisted separately from AccountSecureStorage's per-account namespaces
// (2026-08-07 apply pass addition — the source pack only kept this in
// React state, which meant the account list and active selection were lost
// on every app restart): a small registry of which local accounts exist
// and which is active, so the switcher survives a relaunch.
const REGISTRY_KEY = "linqa.accounts.registry";
const ACTIVE_KEY = "linqa.accounts.active";
const MAX_ACCOUNTS = 3;

function normalizeAccounts(input: unknown): LocalAccount[] {
  if (!Array.isArray(input)) return [];

  const deduped: LocalAccount[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<LocalAccount>;
    if (typeof candidate.userId !== "string" || !candidate.userId.trim()) continue;
    if (typeof candidate.slot !== "number" || (candidate.slot !== 1 && candidate.slot !== 2 && candidate.slot !== 3)) continue;
    if (typeof candidate.displayName !== "string" || !candidate.displayName.trim()) continue;

    if (seen.has(candidate.userId)) continue;
    seen.add(candidate.userId);
    deduped.push({
      userId: candidate.userId,
      slot: candidate.slot,
      displayName: candidate.displayName,
      label: candidate.label,
      phoneSuffix: candidate.phoneSuffix,
      countryIso2: candidate.countryIso2,
      avatarUri: candidate.avatarUri
    } as LocalAccount);

    if (deduped.length >= MAX_ACCOUNTS) break;
  }

  return deduped;
}

/**
 * 2026-08-07 crash fix: every SecureStore call here used to be unguarded
 * (including the initial mount read). A single SecureStore failure — the
 * web platform's expo-secure-store shim doesn't implement getItemAsync at
 * all (confirmed: "_ExpoSecureStore.default.getValueWithKeyAsync is not a
 * function"), and native storage can fail too (first launch, keychain/
 * keystore errors) — produced an *unhandled promise rejection* inside a
 * useEffect, which is exactly what surfaces as a fatal red-screen crash in
 * Expo. Every SecureStore call below is now wrapped so a storage failure
 * degrades to "account state didn't persist this time," never a crash.
 */
// expo-secure-store's web shim doesn't implement getItemAsync at all in this
// SDK — route through localStorage on web (same trust tier the web client
// already uses for its own session token) so persistence genuinely works
// there too, not just "fails without crashing."
const isWeb = Platform.OS === "web";

async function safeGetItem(key: string): Promise<string | null> {
  try {
    return isWeb ? window.localStorage.getItem(key) : await SecureStore.getItemAsync(key);
  } catch (error) {
    console.warn(`[AccountContext] storage read failed for "${key}":`, error);
    return null;
  }
}

async function safeSetItem(key: string, value: string): Promise<void> {
  try {
    if (isWeb) window.localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch (error) {
    console.warn(`[AccountContext] storage write failed for "${key}":`, error);
  }
}

async function safeDeleteItem(key: string): Promise<void> {
  try {
    if (isWeb) window.localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch (error) {
    console.warn(`[AccountContext] storage delete failed for "${key}":`, error);
  }
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccountsState] = useState<LocalAccount[]>([]);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [rawAccounts, rawActive] = await Promise.all([safeGetItem(REGISTRY_KEY), safeGetItem(ACTIVE_KEY)]);
      if (cancelled) return;

      if (rawAccounts) {
        try {
          const parsed = JSON.parse(rawAccounts) as unknown;
          const normalized = normalizeAccounts(parsed);
          setAccountsState(normalized);
          if (rawActive && normalized.some((account) => account.userId === rawActive)) {
            setActiveUserId(rawActive);
          } else if (normalized[0]) {
            setActiveUserId(normalized[0].userId);
            void safeSetItem(ACTIVE_KEY, normalized[0].userId);
          } else {
            setActiveUserId(null);
            void safeDeleteItem(ACTIVE_KEY);
          }
        } catch {
          // Corrupt registry — start empty rather than crash the app.
          setAccountsState([]);
          setActiveUserId(null);
          void safeDeleteItem(ACTIVE_KEY);
        }
      } else if (rawActive) {
        setActiveUserId(rawActive);
      }
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const active = accounts.find((a) => a.userId === activeUserId) ?? accounts[0] ?? null;

  const value = useMemo<AccountContextValue>(
    () => ({
      active,
      accounts,
      loaded,
      setAccounts: (next) => {
        const normalized = normalizeAccounts(next);
        setAccountsState(normalized);
        void safeSetItem(REGISTRY_KEY, JSON.stringify(normalized));

        if (activeUserId && !normalized.some((a) => a.userId === activeUserId)) {
          const fallback = normalized[0]?.userId ?? null;
          setActiveUserId(fallback);
          if (fallback) void safeSetItem(ACTIVE_KEY, fallback);
          else void safeDeleteItem(ACTIVE_KEY);
        }
      },
      activate: (userId) => {
        if (!accounts.some((a) => a.userId === userId)) {
          throw new Error("Account is not available on this device.");
        }
        if (userId !== activeUserId) clearAccountScopedState();
        setActiveUserId(userId);
        void safeSetItem(ACTIVE_KEY, userId);
      },
      // Atomic add-then-activate: setAccounts() followed immediately by
      // activate() in the same call stack used to throw "Account is not
      // available on this device" — activate()'s validation closed over
      // the *pre-update* `accounts` array (React state updates aren't
      // synchronous), so it never saw the account setAccounts() had just
      // added. Using the functional setState form here reads the real
      // latest state instead of a stale closure.
      addAndActivate: (account) => {
        if (account.userId !== activeUserId) clearAccountScopedState();
        setAccountsState((prev) => {
          const existingIndex = prev.findIndex((a) => a.userId === account.userId);
          if (existingIndex >= 0) {
            const next = prev.map((item, index) => index === existingIndex ? { ...item, ...account } : item);
            const normalized = normalizeAccounts(next);
            void safeSetItem(REGISTRY_KEY, JSON.stringify(normalized));
            return normalized;
          }

          const next = normalizeAccounts([...prev, account]);
          void safeSetItem(REGISTRY_KEY, JSON.stringify(next));
          return next;
        });
        setActiveUserId(account.userId);
        void safeSetItem(ACTIVE_KEY, account.userId);
      }
    }),
    [accounts, active, activeUserId, loaded]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAccounts() {
  const value = useContext(Context);
  if (!value) {
    throw new Error("AccountProvider is missing.");
  }
  return value;
}
