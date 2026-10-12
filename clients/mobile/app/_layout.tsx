// Must be the first import: polyfills global.crypto.getRandomValues, which
// @noble/curves (crypto/device-enrollment-proof.ts's Ed25519/X25519 key
// generation) requires and the Hermes RN runtime doesn't provide natively —
// without this, ed25519.keygen()/x25519.keygen() throw
// "crypto.getRandomValues must be defined" the first time a device
// generates its enrollment keypair.
import "react-native-get-random-values";
import { SecureCallHost } from "../components/calls/SecureCallHost";
import { HistoryTransferHost } from "../components/HistoryTransferHost";
import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold
} from "@expo-google-fonts/plus-jakarta-sans";
import { AccountProvider, useAccounts } from "../account/AccountContext";
import { AccountSecureStorage } from "../account/AccountSecureStorage";
import { AccountSessionStore } from "../account/AccountSessionStore";
import { setActiveAccountSessionResolver } from "../services/session";
import { createSessionRefresher } from "../services/session-refresh";
import { useTheme } from "../theme/tokens";
import { getApiBaseUrl } from "../config/api";
import { CallOverlay } from "../components/calls/CallOverlay";
import { startIncomingCallListener } from "../services/incoming-call-listener";

const sessionStore = new AccountSessionStore(new AccountSecureStorage());
const API_BASE_URL = getApiBaseUrl();
const loadFreshSession = createSessionRefresher(sessionStore, API_BASE_URL);

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

/** Keeps this device reachable for calls while an account is signed in, and shows the call screen when one is live. */
function CallHost() {
  const { active, loaded } = useAccounts();
  useEffect(() => {
    if (!loaded || !active) return;
    return startIncomingCallListener();
  }, [active, loaded]);
  return <><CallOverlay /><SecureCallHost /><HistoryTransferHost /></>;
}

export default function RootLayout() {
  const { colors } = useTheme();
  const [fontWaitExpired, setFontWaitExpired] = useState(false);
  const [fontsReady, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold
  });

  useEffect(() => {
    // Remote development assets or a stalled font loader must not hold the
    // entire app on an empty screen. Screens can use system fonts meanwhile.
    if (fontsReady || fontError) return;
    const timer = setTimeout(() => setFontWaitExpired(true), 8000);
    return () => clearTimeout(timer);
  }, [fontsReady, fontError]);

  // Holding the first paint avoids the flash where every screen renders in the
  // system face and then reflows once the real one arrives -- on Home that
  // shifts the whole layout, because the type is what sizes the cards.
  if (!fontsReady && !fontError && !fontWaitExpired) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AccountProvider>
        <AccountSessionBridge />
        <CallHost />
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
        <Stack.Screen name="settings/messaging" />
        <Stack.Screen name="event-log" />
        <Stack.Screen name="settings/storage" />
        <Stack.Screen name="settings/ai-privacy" />
        <Stack.Screen name="settings/privacy-rights" />
        <Stack.Screen name="settings/countrylinqa" />
        <Stack.Screen name="settings/countrylinqa-reach" />
        <Stack.Screen name="countrylinqa/world" />
        <Stack.Screen name="countrylinqa/activate" />
        <Stack.Screen name="countrylinqa/people" />
        <Stack.Screen name="countrylinqa/person" />
        <Stack.Screen name="countrylinqa/countries" />
        <Stack.Screen name="countrylinqa/country" />
        <Stack.Screen name="countrylinqa/communities" />
        <Stack.Screen name="countrylinqa/events" />
        <Stack.Screen name="countrylinqa/businesses" />
        <Stack.Screen name="countrylinqa/search-results" />
        <Stack.Screen name="countrylinqa/search-filters" />
        <Stack.Screen name="countrylinqa/manage-countries" />
        <Stack.Screen name="countrylinqa/more-settings" />
        <Stack.Screen name="countrylinqa/plan" />
        <Stack.Screen name="countrylinqa/blocked" />
        <Stack.Screen name="countrylinqa/plans-compare" />
        <Stack.Screen name="countrylinqa/plans-method" />
        <Stack.Screen name="countrylinqa/plans-confirm" />
        <Stack.Screen name="countrylinqa/plans-result" options={{ gestureEnabled: false }} />
        <Stack.Screen name="countrylinqa/chat-access" options={{ presentation: "transparentModal", animation: "fade" }} />
        <Stack.Screen name="countrylinqa/full-flow" />
        <Stack.Screen name="countrylinqa/list" />
        <Stack.Screen name="countrylinqa/search" />
        <Stack.Screen name="countrylinqa/saved-searches" />
        <Stack.Screen name="countrylinqa/recommendations" />
        <Stack.Screen name="countrylinqa/discovery-profile" />
        <Stack.Screen name="countrylinqa/notifications" />
        <Stack.Screen name="countrylinqa/connections" />
        <Stack.Screen name="countrylinqa/profile" />
        <Stack.Screen name="countrylinqa/security" />
        <Stack.Screen name="countrylinqa/report" />
        <Stack.Screen name="countrylinqa/create" options={{ presentation: "modal" }} />
        <Stack.Screen name="modules/file-vault" />
        <Stack.Screen name="vault/index" />
        <Stack.Screen name="vault/files" />
        <Stack.Screen name="vault/intake" />
        <Stack.Screen name="vault/social" />
        <Stack.Screen name="vault/scan" />
        <Stack.Screen name="vault/save" />
        <Stack.Screen name="vault/private" />
        <Stack.Screen name="vault/share" />
        <Stack.Screen name="vault/plans" />
        <Stack.Screen name="vault/security" />
        <Stack.Screen name="linqasend/index" />
        <Stack.Screen name="linqasend/recipients" />
        <Stack.Screen name="linqasend/amount" />
        <Stack.Screen name="linqasend/select-payment" />
        <Stack.Screen name="linqasend/global-contacts" />
        <Stack.Screen name="linqasend/add-recipient" />
        <Stack.Screen name="linqasend/add-card" />
        <Stack.Screen name="linqasend/transfer-limits" />
        <Stack.Screen name="linqasend/authorize" options={{ presentation: "fullScreenModal", animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="linqasend/review" />
        <Stack.Screen name="linqasend/status" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="linqasend/history" />
        <Stack.Screen name="linqasend/dashboard" />
        <Stack.Screen name="linqasend/receipt" />
        <Stack.Screen name="linqasend/payment-methods" />
        <Stack.Screen name="security/key-transparency" />
        <Stack.Screen name="support/index" />
        <Stack.Screen name="account/add-phone" options={{ presentation: "modal" }} />
        <Stack.Screen name="account/sign-up" />
        <Stack.Screen name="account/sign-up-verify" />
        <Stack.Screen name="account/switcher" />
        <Stack.Screen name="account/add-another" />
        <Stack.Screen name="account/settings" />
        <Stack.Screen name="account/manage" />
        <Stack.Screen name="account/remove" options={{ presentation: "modal" }} />
        <Stack.Screen name="account/max-limit" options={{ presentation: "modal" }} />
        <Stack.Screen name="onboarding/resolve" />
        <Stack.Screen name="onboarding/detect-country" />
        <Stack.Screen name="onboarding/profile" />
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
