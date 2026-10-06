import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAccounts, type LocalAccount } from "../../account/AccountContext";
import { avatarColorForSlot, fonts, radius, useTheme, type Palette } from "../../theme/tokens";
import { ACCOUNT_SWITCH_LANDING_ROUTE } from "../../account/landing";

function accountLabel(account: LocalAccount): string {
  return account.label || account.displayName || "Personal";
}

function accountContact(account: LocalAccount): string {
  const suffix = account.phoneSuffix ? `•••• ${account.phoneSuffix}` : "Phone verified";
  return account.countryIso2 ? `${account.countryIso2} ${suffix}` : suffix;
}

export default function AccountSwitcherScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { accounts, active, activate } = useAccounts();

  function switchTo(account: LocalAccount) {
    activate(account.userId);
    router.replace(ACCOUNT_SWITCH_LANDING_ROUTE);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>
            {active ? `Switch to ${accountLabel(active)}` : "Switch account"}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.card}>
          {accounts.map((account, index) => {
            const selected = account.userId === active?.userId;
            const label = accountLabel(account);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${label}, ${accountContact(account)}${selected ? ", active" : ""}`}
                key={account.userId}
                onPress={() => switchTo(account)}
                style={({ pressed }) => [
                  styles.accountRow,
                  index < accounts.length - 1 && styles.divider,
                  pressed && styles.pressed
                ]}
              >
                <View style={[styles.avatar, { backgroundColor: avatarColorForSlot(account.slot) }]}>
                  <Text style={styles.avatarText}>
                    {label.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "L"}
                  </Text>
                </View>
                <View style={styles.accountCopy}>
                  <Text style={styles.accountName}>{label}</Text>
                  <Text style={styles.accountContact}>{accountContact(account)}</Text>
                </View>
                {selected && <Ionicons name="checkmark" size={23} color={colors.accent} />}
              </Pressable>
            );
          })}
          {accounts.length === 0 && (
            <Text style={styles.empty}>No accounts are available on this device.</Text>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(accounts.length >= 3 ? "/account/max-limit" : "/account/add-another")}
            style={[styles.actionRow, styles.divider]}
          >
            <Ionicons name="add" size={23} color={colors.accent} />
            <Text style={styles.actionText}>Add Account</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/account/manage")}
            style={[styles.actionRow, styles.divider]}
          >
            <Ionicons name="people-outline" size={21} color={colors.text} />
            <Text style={styles.secondaryActionText}>Manage Accounts</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/account/settings")}
            style={styles.actionRow}
          >
            <Ionicons name="settings-outline" size={21} color={colors.text} />
            <Text style={styles.secondaryActionText}>Account Settings</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, padding: 20, paddingTop: 12, paddingBottom: 28 },
  header: { minHeight: 50, flexDirection: "row", alignItems: "center", marginBottom: 16 },
  back: { width: 40, height: 42, justifyContent: "center" },
  title: { flex: 1, color: colors.text, fontFamily: fonts.extrabold, fontSize: 19, textAlign: "center" },
  headerSpacer: { width: 40 },
  card: {
    overflow: "hidden", borderRadius: radius.xl, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border
  },
  accountRow: { minHeight: 74, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontFamily: fonts.extrabold, fontSize: 13 },
  accountCopy: { flex: 1 },
  accountName: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  accountContact: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  actionRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 17 },
  actionText: { flex: 1, color: colors.accent, fontFamily: fonts.bold, fontSize: 14 },
  secondaryActionText: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.surfaceAlt },
  empty: { padding: 18, color: colors.textMuted, fontFamily: fonts.regular, textAlign: "center" },
  cancel: { minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 14 },
  cancelText: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 14 }
});
