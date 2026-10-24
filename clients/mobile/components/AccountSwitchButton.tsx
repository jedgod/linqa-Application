import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { t } from "../i18n";
import { AccountSwitcherSheet } from "./AccountSwitcherSheet";
import { useAccounts } from "../account/AccountContext";
import { ACCOUNT_SWITCH_LANDING_ROUTE } from "../account/landing";

/** Avatar button + account switcher sheet, shared by the phone header and the tablet shell. */
export function AccountSwitchButton() {
  useTranslation();
  const router = useRouter();
  const { accounts, active, activate } = useAccounts();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable style={s.btn} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={t("Switch account")}>
        <Ionicons name="person-circle-outline" size={26} color="#12D6AE" />
        {active?.label || active?.displayName ? <Text style={s.label}>{active.label || active.displayName}</Text> : null}
      </Pressable>

      <AccountSwitcherSheet
        visible={open}
        accounts={accounts}
        activeUserId={active?.userId}
        onClose={() => setOpen(false)}
        onSwitch={(userId) => {
          activate(userId);
          setOpen(false);
          router.replace(ACCOUNT_SWITCH_LANDING_ROUTE);
        }}
        onAdd={() => {
          setOpen(false);
          router.push(accounts.length >= 3 ? "/account/max-limit" : "/account/add-another");
        }}
        onManage={() => {
          setOpen(false);
          router.push("/account/manage");
        }}
        onSettings={() => {
          setOpen(false);
          router.push("/account/settings");
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  label: { color: "#596078", fontSize: 12, fontWeight: "700" }
});
