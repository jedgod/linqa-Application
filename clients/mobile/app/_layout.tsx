// Must be the first import: polyfills global.crypto.getRandomValues, which
// @noble/curves (crypto/device-enrollment-proof.ts's Ed25519/X25519 key
// generation) requires and the Hermes RN runtime doesn't provide natively —
// without this, ed25519.keygen()/x25519.keygen() throw
// "crypto.getRandomValues must be defined" the first time a device
// generates its enrollment keypair.
import "react-native-get-random-values";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccountProvider, useAccounts } from "../account/AccountContext";
import { AccountSecureStorage } from "../account/AccountSecureStorage";
import { AccountSessionStore } from "../account/AccountSessionStore";
import { setActiveAccountSessionResolver } from "../services/session";

const sessionStore = new AccountSessionStore(new AccountSecureStorage());
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";
const refreshes = new Map<string, Promise<Awaited<ReturnType<typeof sessionStore.load>>>>();

async function loadFreshSession(userId: string) {
  const stored = await sessionStore.load(userId);
  if (!stored || new Date(stored.expiresAt).getTime() > Date.now() + 30_000) return stored;

  const existing = refreshes.get(userId);
  if (existing) return existing;
  const refresh = (async () => {
    const response = await fetch(`${API_BASE_URL}/v1/auth/sessions/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: stored.refreshToken })
    });
    if (!response.ok) {
      await sessionStore.remove(userId);
      return null;
    }
    const next = await response.json() as {
      accessToken: string;
      accessTokenExpiresIn: number;
      refreshToken: string;
    };
    const session = {
      ...stored,
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: new Date(Date.now() + next.accessTokenExpiresIn * 1000).toISOString()
    };
    await sessionStore.save(session);
    return session;
  })().finally(() => refreshes.delete(userId));
  refreshes.set(userId, refresh);
  return refresh;
}

/**
 * Bridges the AccountProvider React context to the module-level
 * accessTokenProvider singleton (services/session.ts) so every existing
 * screen that already calls accessTokenProvider.getAccessToken() resolves
 * a real token once an account is active, instead of always failing
 * closed. See services/session.ts for the full explanation.
 */
function AccountSessionBridge() {
  const { active, loaded } = useAccounts();

  useEffect(() => {
    if (!loaded) return;
    if (!active) {
      setActiveAccountSessionResolver(null);
      return;
    }
    setActiveAccountSessionResolver(() => loadFreshSession(active.userId));
    return () => setActiveAccountSessionResolver(null);
  }, [active, loaded]);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AccountProvider>
        <AccountSessionBridge />
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="search" options={{ presentation: "modal" }} />
        <Stack.Screen name="message-requests" />
        <Stack.Screen name="privacy-center" />
        <Stack.Screen name="news/index" />
        <Stack.Screen
          name="status/[statusId]"
          options={{ presentation: "fullScreenModal" }}
        />
        <Stack.Screen name="settings/notifications" />
        <Stack.Screen name="settings/accessibility" />
        <Stack.Screen name="settings/storage" />
        <Stack.Screen name="settings/ai-privacy" />
        <Stack.Screen name="settings/privacy-rights" />
        <Stack.Screen name="settings/countrylinqa" />
        <Stack.Screen name="countrylinqa/world" />
        <Stack.Screen name="countrylinqa/full-flow" />
        <Stack.Screen name="countrylinqa/list" />
        <Stack.Screen name="countrylinqa/create" options={{ presentation: "modal" }} />
        <Stack.Screen name="modules/file-vault" />
        <Stack.Screen name="linqasend/index" />
        <Stack.Screen name="linqasend/recipients" />
        <Stack.Screen name="linqasend/amount" />
        <Stack.Screen name="linqasend/review" />
        <Stack.Screen name="linqasend/status" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="linqasend/history" />
        <Stack.Screen name="linqasend/payment-methods" />
        <Stack.Screen name="security/key-transparency" />
        <Stack.Screen name="support/index" />
        <Stack.Screen name="account/add-phone" options={{ presentation: "modal" }} />
        <Stack.Screen name="account/sign-up" />
        <Stack.Screen name="account/sign-up-verify" />
        <Stack.Screen name="account/manage" />
        <Stack.Screen name="account/remove" options={{ presentation: "modal" }} />
        <Stack.Screen name="account/max-limit" options={{ presentation: "modal" }} />
        <Stack.Screen name="onboarding/resolve" />
        <Stack.Screen name="onboarding/recovery" />
        <Stack.Screen name="onboarding/recovery-verify" />
        <Stack.Screen name="onboarding/country-confirmation" />
        <Stack.Screen name="onboarding/country-clarification" />
        <Stack.Screen name="onboarding/country-discovery" />
        <Stack.Screen name="onboarding/complete" />
        <Stack.Screen name="onboarding/security-review" />
        </Stack>
      </AccountProvider>
    </SafeAreaProvider>
  );
}
