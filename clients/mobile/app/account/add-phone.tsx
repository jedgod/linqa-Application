import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ScreenHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { useMemo } from "react";
import { radius, useTheme, type Palette } from "../../theme/tokens";

export default function AddPhoneAccountScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader eyebrow="STEP 11 OF 15 · ADD LINQA ACCOUNT" title="Sign in to the account"
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

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 40, gap: 20 },
  notice: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 13 },
  noticeText: { color: colors.textMuted, fontSize: 12, lineHeight: 17 }
});
