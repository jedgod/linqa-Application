import { StyleSheet, Text } from "react-native";
import { useMemo } from "react";
import { radius, useTheme, type Palette } from "../theme/tokens";

export function ErrorBanner({ message }: { message: string | null }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  if (!message) return null;
  return <Text style={s.text}>{message}</Text>;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  text: {
    color: colors.danger,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 14,
    fontSize: 12
  }
});
