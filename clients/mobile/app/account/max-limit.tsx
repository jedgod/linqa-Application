import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { PrimaryButton } from "../../components/PrimaryButton";
import { useMemo } from "react";
import { useTheme, type Palette } from "../../theme/tokens";

export default function MaxLimitScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.icon}>
        <Ionicons name="person-outline" size={58} color={colors.accent} />
      </View>
      <Text style={s.title}>Maximum of 3{"\n"}accounts reached</Text>
      <Text style={s.copy}>You have reached the limit of 3 accounts on this device.</Text>
      <View style={s.bottom}>
        <PrimaryButton label="OK" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 24, alignItems: "center", paddingTop: 110 },
  icon: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: colors.accent, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 25, fontWeight: "900", textAlign: "center", marginTop: 26 },
  copy: { color: colors.textMuted, textAlign: "center", lineHeight: 19, marginTop: 12 },
  bottom: { width: "100%", marginTop: "auto", marginBottom: 22 }
});
