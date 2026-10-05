import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { useMemo } from "react";
import { radius, useTheme, type Palette } from "../theme/tokens";

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[s.button, (disabled || busy) && s.disabled]}
    >
      {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.label}>{label}</Text>}
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  button: {
    height: 54,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  disabled: { opacity: 0.5 },
  label: { color: colors.onAccent, fontWeight: "900", fontSize: 15 }
});
