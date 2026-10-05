import { useRef, useMemo } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { radius, useTheme, type Palette } from "../theme/tokens";

export function CodeInput({
  value,
  onChange,
  length = 6
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const refs = useRef<Array<TextInput | null>>([]);

  function setDigit(index: number, digit: string) {
    const clean = digit.replace(/\D/g, "").slice(-1);
    const next = value.split("");
    next[index] = clean;
    const joined = next.join("").slice(0, length);
    onChange(joined);
    if (clean && index < length - 1) refs.current[index + 1]?.focus();
  }

  function handleKeyPress(index: number, key: string) {
    if (key === "Backspace" && !value[index] && index > 0) refs.current[index - 1]?.focus();
  }

  return (
    <View style={s.row}>
      {Array.from({ length }, (_, i) => (
        <TextInput
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] ?? ""}
          onChangeText={(t) => setDigit(i, t)}
          onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
          keyboardType="number-pad"
          maxLength={1}
          style={s.box}
        />
      ))}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  row: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  box: {
    flex: 1,
    height: 58,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "900"
  }
});
