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
import { AccountProvider, useAccounts } from "../account/AccountContext";
import { AccountSecureStorage } from "../account/AccountSecureStorage";
import { AccountSessionStore } from "../account/AccountSessionStore";
import { setActiveAccountSessionResolver } from "../services/session";

const sessionStore = new AccountSessionStore(new AccountSecureStorage());

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
    setActiveAccountSessionResolver(() => sessionStore.load(active.userId));
    return () => setActiveAccountSessionResolver(null);
  }, [active, loaded]);

  return null;
}

export default function RootLayout() {
  return (
    <AccountProvider>
      <AccountSessionBridge />
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="search" options={{ presentation: "modal" }} />
        <Stack.Screen name="message-requests" />
        <Stack.Screen name="privacy-center" />
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
        <Stack.Screen name="account/verify-phone" options={{ presentation: "modal" }} />
        <Stack.Screen name="account/sign-up" />
        <Stack.Screen name="account/sign-up-verify" />
        <Stack.Screen name="account/manage" />
        <Stack.Screen name="account/remove" options={{ presentation: "modal" }} />
        <Stack.Screen name="account/max-limit" options={{ presentation: "modal" }} />
        <Stack.Screen name="auth/register-phone" />
        <Stack.Screen name="auth/verify-phone" />
        <Stack.Screen name="auth/recovery-email" />
        <Stack.Screen name="auth/verify-recovery-email" />
        <Stack.Screen name="auth/account-created" />
      </Stack>
    </AccountProvider>
  );
}
