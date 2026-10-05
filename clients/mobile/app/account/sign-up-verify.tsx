import { useEffect, useState, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BootstrapAuthService } from "../../services/bootstrap-auth.service";
import { MobileHubService } from "../../services/mobile-hub.service";
import { generateDeviceKeyPair, restoreDeviceKeyPair, canonicalEnrollmentDigest, signEnrollmentProof, base64ToBytes, bytesToBase64 } from "../../crypto/device-enrollment-proof";
import { AccountSecureStorage } from "../../account/AccountSecureStorage";
import { AccountSessionStore } from "../../account/AccountSessionStore";
import { getOrCreateInstallationPublicId, currentPlatform } from "../../account/InstallationIdentity";
import { MultiAccountApiService } from "../../services/multi-account.service";
import { useAccounts } from "../../account/AccountContext";
import { cacheInstallationServerId } from "../../account/InstallationRegistry";
import { ScreenHeader } from "../../components/ScreenHeader";
import { CodeInput } from "../../components/CodeInput";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { validateOtpInput } from "../../auth/validation";
import { useTheme, type Palette } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();
const auth = new BootstrapAuthService(API);
const secure = new AccountSecureStorage();
const sessions = new AccountSessionStore(secure);

export default function SignUpVerifyScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ challengeId: string; phone?: string; purpose?: string; addAccount?: string }>();
  const { addAndActivate } = useAccounts();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [resendAt, setResendAt] = useState(Date.now() + 30_000);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function resend() {
    if (busy || resendSeconds > 0 || !params.phone) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const next = await auth.requestChallenge(params.phone, params.purpose === "LOGIN" ? "LOGIN" : "REGISTRATION");
      setChallengeId(next.challengeId);
      router.setParams({ challengeId: next.challengeId });
      setCode("");
      setResendAt(new Date(next.resendAfter).getTime());
      setNotice("A new code was requested. Use the latest code; previous codes no longer work.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request another code.");
    } finally { setBusy(false); }
  }

  async function complete() {
    if (busy) return;
    const validation = validateOtpInput(code);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setBusy(true); setError(null);
    try {
      const verified = await auth.verifyChallenge(challengeId, validation.normalized);
      const isRegistration = params.purpose !== "LOGIN";
      if (isRegistration && verified.accountExists) throw new Error("This number already has an account. Choose Sign In.");
      if (!isRegistration && !verified.accountExists) throw new Error("No Linqa account uses this number. Choose Create Account.");
      const bootstrap = isRegistration
        ? (await auth.register(challengeId)).temporarySession
        : verified.temporarySession;
      if (!bootstrap) throw new Error("verified account session was not issued");

      const challenge = await auth.requestDeviceEnrollmentChallenge(bootstrap.accessToken);
      const [storedSigning, storedEncryption] = await Promise.all([
        secure.get(challenge.userId, "device.signingPrivateKey"),
        secure.get(challenge.userId, "device.encryptionPrivateKey")
      ]);
      const keys = storedSigning && storedEncryption
        ? restoreDeviceKeyPair(base64ToBytes(storedSigning), base64ToBytes(storedEncryption))
        : generateDeviceKeyPair();
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
          expiresAt: new Date(Date.now() + enrolled.session.accessTokenExpiresIn * 1000).toISOString()
        }),
        secure.put(challenge.userId, "device.signingPrivateKey", bytesToBase64(keys.signingPrivateKey)),
        secure.put(challenge.userId, "device.encryptionPrivateKey", bytesToBase64(keys.encryptionPrivateKey)),
        secure.put(challenge.userId, "device.id", enrolled.deviceId)
      ]);
      const token = enrolled.session.accessToken;
      const installationApi = new MultiAccountApiService(API, async () => token);
      const installation = await installationApi.registerInstallation(
        await getOrCreateInstallationPublicId(), platform
      );
      await cacheInstallationServerId(installation.id);
      const attached = await installationApi.addAuthenticatedAccount(installation.id);
      const fallbackName = params.phone ? `Linqa ${params.phone.slice(-4)}` : "Linqa account";
      const displayName = await new MobileHubService(API, async () => token)
        .loadHub()
        .then((hub) => hub.profile.displayName || fallbackName)
        .catch(() => fallbackName);
      addAndActivate({
        userId: challenge.userId,
        slot: attached.accountSlot as 1 | 2 | 3,
        displayName,
        phoneSuffix: params.phone?.slice(-4)
      });
      router.replace("/onboarding/resolve");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Verification failed.";
      setError(message === "invalid_or_expired_code"
        ? "This code is incorrect, expired, or was replaced. Request a new code and use the latest one."
        : message);
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader
          eyebrow="VERIFY MOBILE NUMBER"
          title="Enter the 6-digit code"
          copy="After verification, this device creates its cryptographic identity and the server resumes only the onboarding steps this account still needs."
        />
        <View style={s.field}>
          <CodeInput value={code} onChange={setCode} />
        </View>
        <PrimaryButton label="Verify and secure device" onPress={complete} disabled={code.length !== 6} busy={busy} />
        <ErrorBanner message={error} />
        {notice && <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text>}
        {params.phone && <Pressable accessibilityRole="button" disabled={busy || resendSeconds > 0} onPress={resend} style={s.resend}>
          <Text style={s.resendText}>{resendSeconds > 0 ? "Send a new code in " + resendSeconds + "s" : "Send a new code"}</Text>
        </Pressable>}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 22, paddingTop: 48 },
  field: { marginVertical: 20 },
  notice: { color: colors.textMuted, marginTop: 16 },
  resend: { paddingVertical: 16, alignItems: "center" },
  resendText: { color: colors.accent, fontWeight: "600" }
});
