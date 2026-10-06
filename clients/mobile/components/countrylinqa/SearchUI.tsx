import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CountryLinqaCatalog } from "../../services/countrylinqa.service";
import { flagOf, titleCase } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";
import { world } from "./WorldUI";

/** A labelled row that opens a list under it (Country, Region, Interests...). Closed, it shows its value. */
export function FieldRow({ label, value, open, onToggle, children }: { label: string; value: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
  return (
    <View style={s.field}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${label}, ${value}`} style={s.fieldRow} onPress={onToggle}>
        <Text style={s.fieldLabel}>{label}</Text>
        <Text style={[s.fieldValue, value === "Any" && { color: world.faint }]} numberOfLines={1}>{value}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-forward"} size={18} color={world.faint} />
      </Pressable>
      {open ? <View style={s.fieldBody}>{children}</View> : null}
    </View>
  );
}

export function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={s.field}>
      <View style={s.fieldRow}>
        <Text style={s.fieldLabel}>{label}</Text>
        <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={world.faint} autoCapitalize="none" maxLength={80} style={s.input} />
      </View>
    </View>
  );
}

export function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.toggle}>
      <Text style={s.toggleLabel}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: world.purple, false: "#D0D5DD" }} thumbColor="#FFFFFF" />
    </View>
  );
}

/** Pick one country, or "Any". Shows the first matches while typing. */
export function CountryList({ catalog, value, onPick }: { catalog: CountryLinqaCatalog; value: string; onPick: (code: string) => void }) {
  const [q, setQ] = useState("");
  const rows = catalog.countries.filter((c) => !q.trim() || `${c.name} ${c.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30);
  return (
    <View>
      <TextInput accessibilityLabel="Find a country" value={q} onChangeText={setQ} placeholder="Find a country" placeholderTextColor={world.faint} style={s.find} />
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: value === "" }} style={s.option} onPress={() => onPick("")}><Text style={s.optionText}>Any</Text>{value === "" ? <Ionicons name="checkmark" size={18} color={world.purple} /> : null}</Pressable>
      {rows.map((c) => (
        <Pressable key={c.code} accessibilityRole="radio" accessibilityState={{ selected: value === c.code }} style={s.option} onPress={() => onPick(c.code)}>
          <Text style={s.flag}>{flagOf(c.code)}</Text><Text style={s.optionText}>{c.name}</Text>{value === c.code ? <Ionicons name="checkmark" size={18} color={world.purple} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

export function RegionList({ catalog, value, onPick }: { catalog: CountryLinqaCatalog; value: string; onPick: (code: string) => void }) {
  return (
    <View>
      {[{ code: "", name: "Any" }, ...catalog.regions].map((r) => (
        <Pressable key={r.code || "any"} accessibilityRole="radio" accessibilityState={{ selected: value === r.code }} style={s.option} onPress={() => onPick(r.code)}>
          <Text style={s.optionText}>{r.name}</Text>{value === r.code ? <Ionicons name="checkmark" size={18} color={world.purple} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** Pick any number of options (interests, languages). */
export function ChipPicker({ options, value, onChange }: { options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <Pressable key={o} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[s.chip, on && s.chipOn]} onPress={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            <Text style={[s.chipText, on && { color: "#FFFFFF" }]}>{titleCase(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const listSummary = (items: string[], none = "Any") => (items.length === 0 ? none : items.length <= 2 ? items.map(titleCase).join(", ") : `${items.length} selected`);

const s = StyleSheet.create({
  field: { marginBottom: 8 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, borderRadius: 12, backgroundColor: "#F5F6FB", paddingHorizontal: 14 },
  fieldLabel: { color: world.text, fontFamily: fonts.medium, fontSize: 15, width: 100 },
  fieldValue: { flex: 1, textAlign: "right", color: world.text, fontFamily: fonts.regular, fontSize: 15 },
  input: { flex: 1, textAlign: "right", color: world.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 10 },
  fieldBody: { marginTop: 6, paddingHorizontal: 6, paddingBottom: 6 },
  find: { height: 42, borderRadius: 10, borderWidth: 1, borderColor: world.border, paddingHorizontal: 12, color: world.text, fontFamily: fonts.regular, fontSize: 14, marginBottom: 4 },
  option: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  optionText: { flex: 1, color: world.text, fontFamily: fonts.regular, fontSize: 15 },
  flag: { fontSize: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: world.chip, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: world.purple },
  chipText: { color: world.purple, fontFamily: fonts.medium, fontSize: 14 },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, paddingHorizontal: 4 },
  toggleLabel: { color: world.text, fontFamily: fonts.medium, fontSize: 15 }
});
