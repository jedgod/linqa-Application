import React, { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LocalAccount } from "../account/AccountContext";
import { avatarColorForSlot, radius, useTheme, type Palette } from "../theme/tokens";

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
  onManage,
  onSettings
}: {
  visible: boolean;
  accounts: LocalAccount[];
  activeUserId?: string;
  onClose(): void;
  onSwitch(userId: string): void;
  onAdd(): void;
  onManage(): void;
  onSettings(): void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom + 18, 30) }]}>
          <Text style={s.title}>
            {(() => {
              const activeAccount = accounts.find((account) => account.userId === activeUserId);
              return activeAccount ? `Switch to ${labelForAccount(activeAccount)}` : "Switch account";
            })()}
          </Text>
          {accounts.length >= 3 && <Text style={s.limit}>3 accounts added. All account slots are in use.</Text>}

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

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={accounts.length >= 3 ? "Maximum of 3 accounts reached" : "Add account"}
            style={s.action}
            onPress={onAdd}
          >
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
          <Pressable style={s.action} onPress={onSettings}>
            <Ionicons name="options-outline" size={20} color={colors.accent} />
            <Text style={s.actionText}>Account settings</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={s.cancel}
            onPress={onClose}
          >
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
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
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8
  },
  accountActive: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "white", fontWeight: "900", fontSize: 12 },
  accountText: { flex: 1 },
  name: { color: colors.text, fontWeight: "800", fontSize: 15 },
  nameActive: { color: colors.accent },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
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
  cancel: {
    minHeight: 48, alignItems: "center", justifyContent: "center",
    borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4
  },
  cancelText: { color: colors.text, fontWeight: "700", fontSize: 14 },
});
