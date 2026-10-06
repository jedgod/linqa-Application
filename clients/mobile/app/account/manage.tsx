import { StyleSheet, Text, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAccounts } from "../../account/AccountContext";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useMemo } from "react";
import { avatarColorForSlot, radius, useTheme, type Palette } from "../../theme/tokens";
import { ACCOUNT_SWITCH_LANDING_ROUTE } from "../../account/landing";

export default function ManageAccountsScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { accounts, active, activate } = useAccounts();
  const canAdd = accounts.length < 3;

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader title="Manage Accounts" showBack />

        {accounts.map((account) => {
          const isActive = account.userId === active?.userId;
          return (
            <View key={account.userId} style={s.row}>
              <Pressable
                style={s.rowMain}
                onPress={() => {
                  if (isActive) return;
                  activate(account.userId);
                  router.replace(ACCOUNT_SWITCH_LANDING_ROUTE);
                }}
              >
                <View style={[s.avatar, { backgroundColor: avatarColorForSlot(account.slot) }]}>
                  <Text style={s.avatarText}>{(account.label || account.displayName)[0]?.toUpperCase() ?? "?"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{account.label || account.displayName}</Text>
                  <Text style={s.meta}>
                    {account.countryIso2 ?? ""}
                    {" •••• "}
                    {account.phoneSuffix ?? ""}
                  </Text>
                </View>
              </Pressable>

              {isActive ? (
                <Text style={s.badge}>Active</Text>
              ) : (
                <Pressable
                  style={s.remove}
                  accessibilityLabel="Remove account"
                  onPress={() =>
                    router.push({
                      pathname: "/account/remove",
                      params: { userId: account.userId, displayName: account.label || account.displayName }
                    })
                  }
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              )}
            </View>
          );
        })}

        <Pressable
          style={s.add}
          onPress={() => router.push(canAdd ? "/account/add-another" : "/account/max-limit")}
        >
          <Ionicons name="add" size={21} color={colors.accent} />
          <Text style={s.addText}>Add Account</Text>
        </Pressable>
        <Text style={s.limit}>You can add up to 3 accounts</Text>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 48 },
  row: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 11 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "white", fontWeight: "900" },
  name: { color: colors.text, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 12 },
  badge: {
    color: colors.accent, backgroundColor: colors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.pill, fontSize: 9, fontWeight: "800"
  },
  remove: { padding: 8 },
  add: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, marginTop: 8 },
  addText: { color: colors.accent, fontWeight: "800" },
  limit: { color: colors.textMuted, fontSize: 12, marginLeft: 30, marginTop: -8 }
});
