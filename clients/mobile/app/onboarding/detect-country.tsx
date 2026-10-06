import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { PrimaryButton } from "../../components/PrimaryButton";
import { fonts, useTheme, type Palette } from "../../theme/tokens";

function detectDeviceRegion(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale.split(/[-_]/).slice(1).reverse().find((part) => /^[A-Za-z]{2}$/.test(part));
    return region?.toUpperCase() ?? "US";
  } catch {
    return "US";
  }
}

function flagForRegion(region: string): string {
  return String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0)));
}

export default function DetectCountryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const region = useMemo(detectDeviceRegion, []);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={25} color={colors.textMuted} />
        </Pressable>

        <View style={styles.main}>
          <Text style={styles.step}>STEP 2 OF 15</Text>
          <View style={styles.icon}>
            <Ionicons name="globe-outline" size={38} color={colors.accent} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>Detect your country</Text>
          <Text style={styles.copy}>
            We use your device&rsquo;s regional setting to get started. Your location is not accessed.
          </Text>
          <View style={styles.regionCard}>
            <Text style={styles.flag}>{flagForRegion(region)}</Text>
            <View style={styles.regionText}>
              <Text style={styles.regionLabel}>Suggested region</Text>
              <Text style={styles.regionCode}>{region}</Text>
            </View>
            <Ionicons name="checkmark-circle" size={24} color="#12B76A" />
          </View>
          <Text style={styles.note}>
            You can enter your phone number in international format on the next screen.
          </Text>
        </View>

        <View style={styles.bottom}>
          <PrimaryButton
            label="Continue"
            onPress={() => router.push({
              pathname: "/account/sign-up",
              params: { purpose: "REGISTRATION", countryCode: region }
            })}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, paddingHorizontal: 22, paddingTop: 8, paddingBottom: 24 },
  back: { width: 42, height: 42, justifyContent: "center" },
  main: { alignItems: "center", marginTop: 44 },
  step: { color: colors.accent, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 1 },
  icon: {
    width: 82, height: 82, borderRadius: 41, backgroundColor: colors.surfaceAlt,
    alignItems: "center", justifyContent: "center", marginTop: 28, marginBottom: 24
  },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 27, textAlign: "center" },
  copy: {
    color: colors.textMuted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23,
    textAlign: "center", marginTop: 12, maxWidth: 340
  },
  regionCard: {
    width: "100%", minHeight: 76, flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16, marginTop: 34, borderRadius: 16, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface
  },
  flag: { fontSize: 30 },
  regionText: { flex: 1 },
  regionLabel: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13 },
  regionCode: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18, marginTop: 3 },
  note: {
    color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20,
    textAlign: "center", marginTop: 18, paddingHorizontal: 12
  },
  bottom: { marginTop: "auto" }
});
