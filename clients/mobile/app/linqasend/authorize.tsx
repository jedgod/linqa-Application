import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAccounts } from "../../account/AccountContext";
import { AccountSecureStorage } from "../../account/AccountSecureStorage";
import { authenticateWithBiometrics, biometricInfo, type BiometricInfo } from "../../services/biometric";
import { currentTransactionAuth, finishTransactionAuth } from "../../services/transaction-auth";
import { PIN_LENGTH, TransactionPinStore, pinProblem } from "../../services/transaction-pin";
import { fonts } from "../../theme/tokens";

const dark = { bg: "#08080C", panel: "#14141C", panelBorder: "#23232F", text: "#FFFFFF", muted: "#A3A3B5", accent: "#8F85FF", danger: "#FF6B6B" } as const;

type Mode = "LOADING" | "BIOMETRIC" | "ENTER" | "CREATE" | "CONFIRM_NEW" | "LOCKED";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;

export default function LinqaSendAuthorize() {
  const router = useRouter();
  const { active } = useAccounts();
  const userId = active?.userId ?? null;
  const request = useMemo(() => currentTransactionAuth(), []);
  const store = useMemo(() => new TransactionPinStore(new AccountSecureStorage()), []);

  const [mode, setMode] = useState<Mode>("LOADING");
  const [bio, setBio] = useState<BiometricInfo>({ available: false, label: "", icon: "finger-print-outline" });
  const [hasPin, setHasPin] = useState(false);
  const [digits, setDigits] = useState("");
  const [firstEntry, setFirstEntry] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const done = useRef(false);

  const authorized = useCallback(() => {
    if (done.current) return;
    done.current = true;
    finishTransactionAuth("AUTHORIZED");
    router.back();
  }, [router]);

  const cancel = useCallback(() => {
    if (done.current) return;
    done.current = true;
    finishTransactionAuth("CANCELED");
    router.back();
  }, [router]);

  // Leaving by the system back button counts as cancel, so the transfer never proceeds unconfirmed.
  useEffect(() => () => { if (!done.current) finishTransactionAuth("CANCELED"); }, []);

  const tryBiometric = useCallback(async () => {
    setMessage(null);
    const ok = await authenticateWithBiometrics(`Authorize ${request?.amountLabel ?? "this transfer"}`);
    if (ok) authorized();
    else setMessage("Not recognized. Try again or use your PIN.");
  }, [authorized, request]);

  useEffect(() => {
    if (!userId || !request) { setMode("LOADING"); return; }
    let current = true;
    (async () => {
      const [info, pinSet, status] = await Promise.all([biometricInfo(), store.hasPin(userId), store.status(userId)]);
      if (!current) return;
      setBio(info);
      setHasPin(pinSet);
      if (pinSet && status.lockedUntil) { setLockedUntil(status.lockedUntil); setMode("LOCKED"); return; }
      if (info.available) { setMode("BIOMETRIC"); void tryBiometric(); return; }
      setMode(pinSet ? "ENTER" : "CREATE");
    })();
    return () => { current = false; };
  }, [userId, request, store, tryBiometric]);

  // Nothing to authorize (opened directly or restored after a restart): go back rather than show a blank gate.
  useEffect(() => { if (!request) cancel(); }, [request, cancel]);

  async function submit(code: string) {
    if (!userId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "CREATE") {
        const problem = pinProblem(code);
        if (problem) { setMessage(problem === "WEAK" ? "That PIN is too easy to guess. Avoid repeats and sequences." : "Use exactly 6 digits."); setDigits(""); return; }
        setFirstEntry(code); setDigits(""); setMode("CONFIRM_NEW");
        return;
      }
      if (mode === "CONFIRM_NEW") {
        if (code !== firstEntry) { setMessage("PINs did not match. Start again."); setFirstEntry(""); setDigits(""); setMode("CREATE"); return; }
        await store.setPin(userId, code);
        setHasPin(true);
        authorized();
        return;
      }
      const result = await store.verify(userId, code);
      if (result.ok) { authorized(); return; }
      setDigits("");
      if (result.reason === "LOCKED") { setLockedUntil(result.lockedUntil); setMode("LOCKED"); return; }
      setMessage(`Incorrect PIN. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? "" : "s"} left.`);
    } catch {
      setMessage("Could not check your PIN. Try again.");
      setDigits("");
    } finally {
      setBusy(false);
    }
  }

  function press(key: string) {
    if (busy || mode === "LOADING" || mode === "LOCKED" || mode === "BIOMETRIC") return;
    if (key === "⌫") { setDigits((d) => d.slice(0, -1)); return; }
    if (!key) return;
    const next = (digits + key).slice(0, PIN_LENGTH);
    setDigits(next);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  const pinMode = mode === "ENTER" || mode === "CREATE" || mode === "CONFIRM_NEW";
  const title = mode === "CREATE" ? "Create your transfer PIN" : mode === "CONFIRM_NEW" ? "Confirm your PIN" : "Confirm Transfer";
  const helper =
    busy ? "Checking…"
    : mode === "CREATE" ? "Choose 6 digits. You will use this PIN to authorize transfers on this device."
    : mode === "CONFIRM_NEW" ? "Enter the same 6 digits again."
    : mode === "ENTER" ? "Enter your 6-digit PIN to authorize this transfer."
    : mode === "BIOMETRIC" ? `Use ${bio.label} to authorize this transfer.`
    : mode === "LOCKED" ? `Too many attempts. Try again in ${Math.max(1, Math.ceil(((lockedUntil ?? Date.now()) - Date.now()) / 60000))} minute(s).`
    : "";

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="light" />
      <View style={s.top}>
        <View style={s.brandRow}>
          <View style={s.logoMark}><Ionicons name="paper-plane" size={16} color={dark.accent} /></View>
          <Text style={s.brand}>LinqaSend</Text>
        </View>
        <Text accessibilityRole="header" style={s.title}>{title}</Text>
        {request ? (
          <>
            <Text style={s.amount}>{request.amountLabel}</Text>
            <Text style={s.to}>to {request.recipientName}</Text>
          </>
        ) : null}
      </View>

      <View style={s.panel}>
        {mode === "LOADING" ? <ActivityIndicator color={dark.accent} /> : null}

        {mode === "BIOMETRIC" ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Use ${bio.label}`} style={s.bioButton} onPress={() => void tryBiometric()}>
            <Ionicons name={bio.icon} size={92} color={dark.accent} />
            <Text style={s.bioLabel}>{bio.label}</Text>
          </Pressable>
        ) : null}

        {mode === "LOCKED" ? <Ionicons name="lock-closed" size={72} color={dark.muted} /> : null}

        {pinMode ? (
          <>
            <View style={s.dots} accessibilityLabel={`${digits.length} of ${PIN_LENGTH} digits entered`}>
              {Array.from({ length: PIN_LENGTH }, (_, i) => <View key={i} style={[s.dot, i < digits.length && s.dotOn]} />)}
            </View>
            <View style={s.keypad}>
              {KEYS.map((key, index) => (
                <Pressable
                  key={index}
                  accessibilityRole="button"
                  accessibilityLabel={key === "⌫" ? "Delete" : key || undefined}
                  disabled={!key}
                  style={[s.key, !key && { opacity: 0 }]}
                  onPress={() => press(key)}
                >
                  <Text style={s.keyText}>{key}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </View>

      <Text style={[s.helper, message ? { color: dark.danger } : null]} accessibilityLiveRegion="polite">{message ?? helper}</Text>

      <View style={s.bottom}>
        {mode === "BIOMETRIC" ? (
          <Pressable accessibilityRole="button" onPress={() => { setMessage(null); setMode(hasPin ? "ENTER" : "CREATE"); }}>
            <Text style={s.link}>{hasPin ? "Use PIN instead" : "Create a PIN instead"}</Text>
          </Pressable>
        ) : null}
        {pinMode && bio.available ? (
          <Pressable accessibilityRole="button" onPress={() => { setDigits(""); setMode("BIOMETRIC"); void tryBiometric(); }}>
            <Text style={s.link}>Use {bio.label}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" style={s.cancel} onPress={cancel}>
          <Text style={s.link}>Cancel</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: dark.bg, paddingHorizontal: 24 },
  top: { alignItems: "center", paddingTop: 24 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: { width: 30, height: 30, borderRadius: 8, borderWidth: 2, borderColor: dark.accent, alignItems: "center", justifyContent: "center" },
  brand: { color: dark.text, fontFamily: fonts.extrabold, fontSize: 18 },
  title: { color: dark.text, fontFamily: fonts.bold, fontSize: 18, marginTop: 34 },
  amount: { color: dark.text, fontFamily: fonts.extrabold, fontSize: 18, marginTop: 18 },
  to: { color: dark.text, fontFamily: fonts.medium, fontSize: 16, marginTop: 8 },
  panel: { alignSelf: "center", width: "100%", maxWidth: 360, minHeight: 250, borderRadius: 24, backgroundColor: dark.panel, borderWidth: 1, borderColor: dark.panelBorder, alignItems: "center", justifyContent: "center", paddingVertical: 20, marginTop: 28 },
  bioButton: { alignItems: "center", gap: 14, padding: 12 },
  bioLabel: { color: dark.text, fontFamily: fonts.bold, fontSize: 18 },
  dots: { flexDirection: "row", gap: 14, marginBottom: 18 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: dark.muted },
  dotOn: { backgroundColor: dark.accent, borderColor: dark.accent },
  keypad: { flexDirection: "row", flexWrap: "wrap", width: 270, justifyContent: "space-between", rowGap: 8 },
  key: { width: 82, height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  keyText: { color: dark.text, fontFamily: fonts.semibold, fontSize: 18 },
  helper: { color: dark.text, fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, textAlign: "center", marginTop: 26, paddingHorizontal: 12 },
  bottom: { flex: 1, justifyContent: "flex-end", alignItems: "center", gap: 6, paddingBottom: 16 },
  cancel: { paddingVertical: 12, paddingHorizontal: 24 },
  link: { color: dark.accent, fontFamily: fonts.semibold, fontSize: 16, paddingVertical: 8 }
});
