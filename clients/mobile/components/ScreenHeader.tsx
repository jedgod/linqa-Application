import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { useTheme, type Palette } from "../theme/tokens";

export function ScreenHeader({
  eyebrow,
  title,
  copy,
  showBack = false
}: {
  eyebrow?: string;
  title: string;
  copy?: string;
  showBack?: boolean;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  return (
    <View>
      {showBack && (
        <Pressable onPress={() => router.back()} style={s.back} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={colors.textMuted} />
        </Pressable>
      )}
      {eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}
      <Text style={s.title}>{title}</Text>
      {copy && <Text style={s.copy}>{copy}</Text>}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  back: { marginBottom: 10, width: 32, height: 32, justifyContent: "center" },
  eyebrow: { color: colors.accent, fontWeight: "900", fontSize: 12, letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 26, fontWeight: "900", marginTop: 4, lineHeight: 32 },
  copy: { color: colors.textMuted, lineHeight: 20, marginTop: 10, marginBottom: 4 }
});
