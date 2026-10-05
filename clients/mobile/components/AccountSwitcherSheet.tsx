import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LocalAccount } from "../account/AccountContext";
import { avatarColorForSlot, colors, radius } from "../theme/tokens";

function labelForAccount(account: LocalAccount) {
  return account.label || account.displayName || "Personal";
}

export function AccountSwitcherSheet({
  visible,
  accounts,
  activeUserId,
  onClose,
  onSwitch,
  onAdd,
  onManage
}: {
  visible: boolean;
  accounts: LocalAccount[];
  activeUserId?: string;
  onClose(): void;
  onSwitch(userId: string): void;
  onAdd(): void;
  onManage(): void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom + 18, 30) }]}>
          <Text style={s.title}>Switch account</Text>

          {accounts.map((account) => {
            const active = account.userId === activeUserId;
            const primaryLabel = labelForAccount(account);
            const phoneText = account.countryIso2 ? `${account.countryIso2} •••• ${account.phoneSuffix ?? ""}` : `•••• ${account.phoneSuffix ?? ""}`;

            return (
              <Pressable
                key={account.userId}
                style={[s.account, active && s.accountActive]}
                onPress={() => onSwitch(account.userId)}
              >
                <View style={[s.avatar, { backgroundColor: avatarColorForSlot(account.slot) }]}> 
                  <Text style={s.avatarText}>
                    {primaryLabel
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0] ?? "")
                      .join("")
                      .toUpperCase() || "L"}
                  </Text>
                </View>

                <View style={s.accountText}>
                  <Text style={[s.name, active && s.nameActive]}>{active ? "✓ " : ""}{primaryLabel}</Text>
                  <Text style={s.meta}>{phoneText}</Text>
                </View>

                {active && <Ionicons name="checkmark-circle" size={22} color={colors.accent} />}
              </Pressable>
            );
          })}

          <Pressable disabled={accounts.length >= 3} style={[s.action, accounts.length >= 3 && s.disabled]} onPress={onAdd}>
            <Ionicons name="add-circle-outline" size={21} color={colors.accent} />
            <View style={s.actionTextWrap}>
              <Text style={s.actionText}>Add account</Text>
              {accounts.length >= 3 && <Text style={s.limit}>Maximum of 3 Linqa accounts reached</Text>}
            </View>
          </Pressable>

          <Pressable style={s.action} onPress={onManage}>
            <Ionicons name="settings-outline" size={20} color={colors.accent} />
            <Text style={s.actionText}>Manage accounts</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#0D1E2B",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 30
  },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginBottom: 14 },
  account: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#1A3344",
    borderRadius: 16,
    backgroundColor: "#112A3D",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8
  },
  accountActive: { borderColor: "#1ED6B5", backgroundColor: "#102B36" },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "white", fontWeight: "900", fontSize: 12 },
  accountText: { flex: 1 },
  name: { color: colors.text, fontWeight: "800", fontSize: 15 },
  nameActive: { color: colors.accent },
  meta: { color: "#8FA4B7", fontSize: 12, marginTop: 3 },
  action: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 4
  },
  actionTextWrap: { flex: 1 },
  actionText: { color: colors.accent, fontWeight: "900", fontSize: 15 },
  limit: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  disabled: { opacity: 0.45 }
});
