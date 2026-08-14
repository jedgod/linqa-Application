import { StyleSheet, Text } from "react-native";
import { colors, radius } from "../theme/tokens";

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={s.text}>{message}</Text>;
}

const s = StyleSheet.create({
  text: {
    color: colors.danger,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 14,
    fontSize: 12
  }
});
