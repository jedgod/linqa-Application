import { useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BootstrapAuthService } from "../../services/bootstrap-auth.service";
import { generateDeviceKeyPair, canonicalEnrollmentDigest, signEnrollmentProof, base64ToBytes, bytesToBase64 } from "../../crypto/device-enrollment-proof";
import { AccountSecureStorage } from "../../account/AccountSecureStorage";
import { AccountSessionStore } from "../../account/AccountSessionStore";
import { getOrCreateInstallationPublicId, currentPlatform } from "../../account/InstallationIdentity";
import { MultiAccountApiService } from "../../services/multi-account.service";
import { PhoneFirstIdentityService } from "../../services/phone-first.service";
import { useAccounts } from "../../account/AccountContext";
import { cacheInstallationServerId } from "../../account/InstallationRegistry";
import { ScreenHeader } from "../../components/ScreenHeader";
import { CodeInput } from "../../components/CodeInput";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { validateOtpInput } from "../../auth/validation";
import { colors } from "../../theme/tokens";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";
const auth = new BootstrapAuthService(API);
const secure = new AccountSecureStorage();
const sessions = new AccountSessionStore(secure);

export default function SignUpVerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ challengeId: string; phone?: string }>();
  const { addAndActivate } = useAccounts();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    const validation = validateOtpInput(code);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setBusy(true); setError(null);
    try {
      const verified = await auth.verifyChallenge(params.challengeId, validation.normalized);
      const bootstrap = verified.accountExists
        ? verified.temporarySession
        : (await auth.register(params.challengeId)).temporarySession;
      if (!bootstrap) throw new Error("verified account session was not issued");

      const challenge = await auth.requestDeviceEnrollmentChallenge(bootstrap.accessToken);
      const keys = generateDeviceKeyPair();
      const deviceName = "Linqa Mobile";
      const platform = currentPlatform();
      const digest = canonicalEnrollmentDigest({
        challengeId: challenge.challengeId,
        userId: challenge.userId,
        nonce: base64ToBytes(challenge.nonceBase64),
        expiresAtUnix: BigInt(Math.floor(new Date(challenge.expiresAt).getTime() / 1000)),
        deviceName,
        platform,
        signingPublicKey: keys.signingPublicKey,
        encryptionPublicKey: keys.encryptionPublicKey
      });
      const enrolled = await auth.completeDeviceEnrollment(bootstrap.accessToken, {
        challengeId: challenge.challengeId,
        deviceName,
        platform,
        signingPublicKeyBase64: bytesToBase64(keys.signingPublicKey),
        encryptionPublicKeyBase64: bytesToBase64(keys.encryptionPublicKey),
        signatureBase64: bytesToBase64(signEnrollmentProof(digest, keys.signingPrivateKey))
      });

      await Promise.all([
        sessions.save({
          userId: challenge.userId,
          accessToken: enrolled.session.accessToken,
          refreshToken: enrolled.session.refreshToken,
          sessionId: enrolled.session.sessionId,
          expiresAt: enrolled.session.refreshTokenExpiresAt
        }),
        secure.put(challenge.userId, "device.signingPrivateKey", bytesToBase64(keys.signingPrivateKey)),
        secure.put(challenge.userId, "device.encryptionPrivateKey", bytesToBase64(keys.encryptionPrivateKey)),
        secure.put(challenge.userId, "device.id", enrolled.deviceId)
      ]);
      addAndActivate({ userId: challenge.userId, slot: 1 as const, displayName: "Linqa account" });

      const token = enrolled.session.accessToken;
      const installationApi = new MultiAccountApiService(API, async () => token);
      const installation = await installationApi.registerInstallation(
        await getOrCreateInstallationPublicId(), platform
      );
      await cacheInstallationServerId(installation.id);
      const phoneFirst = new PhoneFirstIdentityService(API, async () => token);
      const flow = await phoneFirst.start(installation.id);
      router.replace({
        pathname: "/auth/register-phone",
        params: { flowId: flow.id, phone: params.phone ?? "" }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed.");
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader
          eyebrow="VERIFY MOBILE NUMBER"
          title="Enter the 6-digit code"
          copy="After verification, this device creates its cryptographic identity and continues to recovery-email setup."
        />
        <View style={s.field}>
          <CodeInput value={code} onChange={setCode} />
        </View>
        <PrimaryButton label="Verify and secure device" onPress={complete} disabled={code.length !== 6} busy={busy} />
        <ErrorBanner message={error} />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { padding: 22, paddingTop: 48 },
  field: { marginVertical: 20 }
});
