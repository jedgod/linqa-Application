import { useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MultiAccountApiService } from "../../services/multi-account.service";
import { accessTokenProvider } from "../../services/session";
import { getOrCreateInstallationPublicId, currentPlatform } from "../../account/InstallationIdentity";
import { useAccounts } from "../../account/AccountContext";
import { AccountSecureStorage } from "../../account/AccountSecureStorage";
import { AccountSessionStore } from "../../account/AccountSessionStore";
import { cacheInstallationServerId } from "../../account/InstallationRegistry";
import { ScreenHeader } from "../../components/ScreenHeader";
import { CodeInput } from "../../components/CodeInput";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { colors } from "../../theme/tokens";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";
const sessionStore = new AccountSessionStore(new AccountSecureStorage());

/** Reads the `user_id` claim out of the current access token without verifying its signature — this client already trusts the token it just used to authenticate the request. */
function decodeUserIdFromJwt(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed access token.");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    atob(normalized)
      .split("")
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
  const claims = JSON.parse(json) as { user_id?: string };
  if (!claims.user_id) throw new Error("Access token has no user_id claim.");
  return claims.user_id;
}

export default function VerifyPhoneScreen() {
  const router = useRouter();
  const { phoneIdentityId, challengeId } = useLocalSearchParams<{ phoneIdentityId: string; challengeId: string }>();
  const { addAndActivate } = useAccounts();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    if (!phoneIdentityId || !challengeId) {
      setError("Missing verification challenge.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const getToken = () => accessTokenProvider.getAccessToken();
      const client = new MultiAccountApiService(API_BASE_URL, getToken);

      const verified = await client.completePhoneVerification({ phoneIdentityId, challengeId, code });

      const installationPublicId = await getOrCreateInstallationPublicId();
      const installation = await client.registerInstallation(installationPublicId, currentPlatform());
      await cacheInstallationServerId(installation.id);

      // NOTE: this client has no separate signup/login flow, so the phone
      // number just verified always belongs to whichever session was
      // already active (there is no mechanism here to authenticate a
      // second, different person's identity). This registers the current
      // account into this installation's slot list and activates it
      // locally; it does not onboard a genuinely different identity.
      const currentUserId = decodeUserIdFromJwt(await getToken());
      const added = await client.addAccount(installation.id, currentUserId);
      const switched = await client.switchAccount(installation.id, added.userId);

      await sessionStore.save({
        userId: added.userId,
        accessToken: switched.accessToken,
        refreshToken: switched.refreshToken,
        sessionId: switched.sessionId,
        expiresAt: switched.expiresAt
      });

      addAndActivate({
        userId: added.userId,
        slot: added.accountSlot as 1 | 2 | 3,
        displayName: verified.national_number_suffix ? `+•••• ${verified.national_number_suffix}` : "New account",
        countryIso2: verified.country_iso2,
        phoneSuffix: verified.national_number_suffix
      });

      router.back();
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify this code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader title="Verify your number" copy="Enter the 6-digit code sent to your verified mobile line." />
        <View style={s.field}>
          <CodeInput value={code} onChange={setCode} />
        </View>
        <ErrorBanner message={error} />
        <PrimaryButton label="Verify Code" onPress={handleVerify} disabled={code.length !== 6} busy={busy} />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 60 },
  field: { marginTop: 28, marginBottom: 18 }
});
