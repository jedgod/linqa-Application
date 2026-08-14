import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, radius } from "../theme/tokens";

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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[s.button, (disabled || busy) && s.disabled]}
    >
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.label}>{label}</Text>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: {
    height: 54,
    borderRadius: 12,
    backgroundColor: "#165DFF",
    alignItems: "center",
    justifyContent: "center"
  },
  disabled: { opacity: 0.5 },
  label: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 }
});
