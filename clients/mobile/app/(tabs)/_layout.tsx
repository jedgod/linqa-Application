import { useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AccountSwitcherSheet } from "../../components/AccountSwitcherSheet";
import { useAccounts } from "../../account/AccountContext";

function AccountHeader() {
  const router = useRouter();
  const { accounts, active, activate } = useAccounts();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <View style={s.header}>
      <Text style={s.brand}>Linqa</Text>
      <Pressable style={s.avatarBtn} onPress={() => setSwitcherOpen(true)} accessibilityLabel="Switch account">
        <Ionicons name="person-circle-outline" size={26} color="#12D6AE" />
        {active?.label || active?.displayName ? <Text style={s.avatarLabel}>{active.label || active.displayName}</Text> : null}
      </Pressable>

      <AccountSwitcherSheet
        visible={switcherOpen}
        accounts={accounts}
        activeUserId={active?.userId}
        onClose={() => setSwitcherOpen(false)}
        onSwitch={(userId) => {
          activate(userId);
          setSwitcherOpen(false);
        }}
        onAdd={() => {
          setSwitcherOpen(false);
          router.push("/account/add-phone");
        }}
        onManage={() => {
          setSwitcherOpen(false);
          router.push("/account/manage");
        }}
      />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        header: () => <AccountHeader />,
        tabBarStyle: { backgroundColor: "#001520", borderTopColor: "#17445A" },
        tabBarActiveTintColor: "#12D6AE",
        tabBarInactiveTintColor: "#7D95A8"
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: "Calls",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="call-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="communities"
        options={{
          title: "Communities",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen name="media" options={{ href: null }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  header: {
    height: 52,
    paddingTop: 4,
    paddingHorizontal: 16,
    backgroundColor: "#001520",
    borderBottomWidth: 1,
    borderBottomColor: "#17445A",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  brand: { color: "#F5FBFF", fontWeight: "900", fontSize: 16 },
  avatarBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  avatarLabel: { color: "#9BC8C5", fontSize: 12, fontWeight: "700" }
});
