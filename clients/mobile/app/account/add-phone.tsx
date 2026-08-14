import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ScreenHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { colors, radius } from "../../theme/tokens";

export default function AddPhoneAccountScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader eyebrow="ADD LINQA ACCOUNT" title="Sign in to the account"
          copy="Adding an account requires a fresh login and device enrollment. Linqa derives the target identity from that ceremony; an account ID is never accepted from the app." showBack />
        <PrimaryButton label="Continue to secure sign in" onPress={() => router.replace({
          pathname: "/account/sign-up", params: { purpose: "LOGIN", addAccount: "1" }
        })} />
        <View style={s.notice}><Text style={s.noticeText}>
          The same server phone authority performs E.164 normalization, carrier and line-type checks, risk assessment, and OTP verification.
        </Text></View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 40, gap: 20 },
  notice: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 13 },
  noticeText: { color: "#9BC8C5", fontSize: 11, lineHeight: 17 }
});
