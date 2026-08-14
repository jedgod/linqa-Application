import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius } from "../theme/tokens";

export function PhoneField({
  country,
  onCountryChange,
  number,
  onNumberChange
}: {
  country: string;
  onCountryChange: (v: string) => void;
  number: string;
  onNumberChange: (v: string) => void;
}) {
  return (
    <View>
      <Text style={s.label}>Mobile number</Text>
      <View style={s.row}>
        <TextInput
          value={country}
          onChangeText={(v) => onCountryChange(v.toUpperCase())}
          autoCapitalize="characters"
          maxLength={2}
          placeholder="US"
          placeholderTextColor={colors.textFaint}
          style={s.country}
        />
        <TextInput
          value={number}
          onChangeText={onNumberChange}
          keyboardType="phone-pad"
          placeholder="202 555 0123"
          placeholderTextColor={colors.textFaint}
          style={s.number}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  label: { color: colors.textMuted, fontWeight: "700", marginBottom: 6, fontSize: 12 },
  row: { flexDirection: "row", gap: 8 },
  country: {
    width: 66,
    height: 54,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    color: colors.text,
    textAlign: "center",
    fontWeight: "800"
  },
  number: {
    flex: 1,
    height: 54,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: 14
  }
});
