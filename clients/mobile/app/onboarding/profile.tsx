import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { accessTokenProvider } from "../../services/session";
import { ScreenHeader } from "../../components/ScreenHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useAccounts } from "../../account/AccountContext";
import { getApiBaseUrl } from "../../config/api";
const API = getApiBaseUrl();
export default function RegistrationProfile() {
  const router = useRouter();
  const { active, addAndActivate } = useAccounts();
  const params = useLocalSearchParams<{ flow?: string }>();
  const [fullName, setFullName] = useState("");
  const [stageName, setStageName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    (async () => {
      const response = await fetch(API + "/v1/onboarding/profile", { headers: { authorization: "Bearer " + await accessTokenProvider.getAccessToken() } });
      if (!response.ok) throw new Error("Unable to load your profile. Please try again.");
      const data = await response.json();
      if (active) { setFullName(data.fullName ?? ""); setStageName(data.stageName ?? ""); }
    })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load your profile."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  async function next() {
    if (submitting.current || loading) return;
    const name = fullName.trim(), stage = stageName.trim();
    if (!name || !stage || /[\u0000-\u001f\u007f]/u.test(name + stage)) {
      setError("Enter your name and a stage name to continue."); return;
    }
    submitting.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(API + "/v1/onboarding/profile", { method: "POST", headers: {
        authorization: "Bearer " + await accessTokenProvider.getAccessToken(), "content-type": "application/json"
      }, body: JSON.stringify({ fullName: name, stageName: stage }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? "Unable to save your names. Please try again.");
      if (active) addAndActivate({ ...active, displayName: stage });
      router.replace({ pathname: "/onboarding/resolve", params: params.flow ? { flow: params.flow } : {} });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save your names."); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <SafeAreaView style={s.screen}><KeyboardAvoidingView style={s.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader eyebrow="ACCOUNT PROFILE" title="Your name and stage name" copy="Both are required to finish registration. Your stage name is the name other people see in Linqa." />
      <Text style={s.label}>Name</Text>
      <TextInput accessibilityLabel="Name" style={s.input} value={fullName} onChangeText={setFullName} placeholder="Your name" autoCapitalize="words" autoCorrect={false} maxLength={100} editable={!busy && !loading} />
      <Text style={s.label}>Stage name</Text>
      <TextInput accessibilityLabel="Stage name" style={s.input} value={stageName} onChangeText={setStageName} placeholder="Choose your stage name" autoCapitalize="words" autoCorrect={false} maxLength={100} editable={!busy && !loading} />
      <ErrorBanner message={error} />
      {error && <PrimaryButton label="Reload saved profile" onPress={() => setAttempt(v => v + 1)} disabled={busy || loading} />}
      <PrimaryButton label="Save and continue" onPress={next} disabled={loading || !fullName.trim() || !stageName.trim()} busy={busy} />
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#fff" }, content: { padding: 22, paddingTop: 40, gap: 12 }, label: { marginTop: 12, fontWeight: "600", fontSize: 15, color: "#344054" }, input: { height: 54, borderWidth: 1, borderColor: "#E1E6EF", borderRadius: 12, paddingHorizontal: 14, fontSize: 16 } });
