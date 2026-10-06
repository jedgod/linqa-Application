import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CountryButton, CountryError, CountryInput, CountryPage, countryStyles as s, useCountryClient } from "../../components/CountryLinqaUI";

export default function CountryLinqaReport() {
  const { subjectType, subjectId } = useLocalSearchParams<{ subjectType?: string; subjectId?: string }>();
  const client = useCountryClient(); const router = useRouter();
  const [reason, setReason] = useState<"SPAM" | "FRAUD" | "ABUSE" | "OTHER">("SPAM");
  const [details, setDetails] = useState(""); const [busy, setBusy] = useState(false); const [reported, setReported] = useState(false); const [error, setError] = useState<string | null>(null);
  const valid = ["USER","POST","EVENT","BUSINESS"].includes(subjectType ?? "") && !!subjectId;
  async function submit() { if (!valid) return; setBusy(true); setError(null); try { await client.report({ subjectType: subjectType as "USER" | "POST" | "EVENT" | "BUSINESS", subjectId: subjectId!, reason, details }); setReported(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to submit report"); } finally { setBusy(false); } }
  return <CountryPage title="Report to Moderation">{reported ? <View style={s.card}><Text style={s.cardTitle}>Report submitted</Text><Text style={s.copy}>Your report is in the moderation queue for review.</Text><CountryButton label="Done" onPress={() => router.back()} /></View> : <><Text style={s.copy}>Tell the moderation team what needs attention.</Text><View style={s.chips}>{(["SPAM","FRAUD","ABUSE","OTHER"] as const).map(value => <Pressable key={value} style={s.chip} accessibilityRole="radio" accessibilityState={{ checked: reason === value }} onPress={() => setReason(value)}><Text style={s.copy}>{reason === value ? "✓ " : ""}{value}</Text></Pressable>)}</View><CountryInput label="Details (optional)" value={details} onChange={setDetails} /><CountryError error={error ?? (!valid ? "This report link is invalid." : null)} /><CountryButton label={busy ? "Submitting…" : "Submit report"} disabled={busy || !valid} onPress={() => void submit()} /></>}</CountryPage>;
}
