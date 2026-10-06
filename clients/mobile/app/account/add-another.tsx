import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAccounts } from "../../account/AccountContext";
import { fonts, radius, useTheme, type Palette } from "../../theme/tokens";

const BENEFITS = [
  "Up to 3 accounts on this device",
  "Separate account sessions and data",
  "Fresh verification keeps each account secure"
];

export default function AddAnotherAccountScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { accounts } = useAccounts();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <ScreenHeader eyebrow="ACCOUNT SWITCHER" title="Add another account" copy="Keep your accounts separate and switch between them from your avatar." showBack />
        <View style={styles.art}>
          <View style={[styles.phone, styles.phoneBack]}>
            <Ionicons name="person-outline" size={29} color={colors.accent} />
          </View>
          <View style={styles.phone}>
            <Ionicons name="person-add-outline" size={36} color={colors.accent} />
          </View>
        </View>
        <View style={styles.benefits}>
          {BENEFITS.map((benefit) => (
            <View style={styles.benefit} key={benefit}>
              <Ionicons name="checkmark-circle" size={20} color="#12B76A" />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>
        <View style={styles.bottom}>
          <Text style={styles.count}>{accounts.length} of 3 account slots used</Text>
          <PrimaryButton
            label="Continue to verification"
            onPress={() => router.push("/account/add-phone")}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, paddingHorizontal: 22, paddingTop: 32, paddingBottom: 24 },
  art: { height: 210, flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 12 },
  phone: {
    width: 96, height: 128, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.accent,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center"
  },
  phoneBack: { marginRight: -18, transform: [{ rotate: "-12deg" }], opacity: 0.72 },
  benefits: { gap: 16, marginTop: 10 },
  benefit: { flexDirection: "row", alignItems: "center", gap: 11 },
  benefitText: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
  bottom: { marginTop: "auto", gap: 12 },
  count: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" }
});
