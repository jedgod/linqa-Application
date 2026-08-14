import { useEffect, useMemo, useState } from "react";
import { Tabs, usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AccountSwitcherSheet } from "../../components/AccountSwitcherSheet";
import { QuickCreateSheet } from "../../components/QuickCreateSheet";
import { useAccounts } from "../../account/AccountContext";
import { createActionsForPath } from "../../navigation/information-architecture";
import { ActivityIndicator } from "react-native";
import { OnboardingApiService } from "../../services/onboarding.service";
import { accessTokenProvider } from "../../services/session";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

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
          router.replace("/onboarding/resolve");
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
  const router = useRouter();
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);
  const actions = createActionsForPath(pathname);
  const { active } = useAccounts();
  const onboarding = useMemo(() => new OnboardingApiService(API, accessTokenProvider), []);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setAllowed(false);
    onboarding.status().then((status) => {
      if (cancelled) return;
      if (status.nextStep !== "COMPLETE") router.replace("/onboarding/resolve");
      else setAllowed(true);
    }).catch(() => { if (!cancelled) router.replace("/onboarding/resolve"); });
    return () => { cancelled = true; };
  }, [active?.userId, onboarding, router]);

  if (!allowed) return <View style={s.guard}><ActivityIndicator color="#6558DC" /></View>;

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: true,
          header: () => <AccountHeader />,
          tabBarStyle: s.tabBar,
          tabBarLabelStyle: s.tabLabel,
          tabBarActiveTintColor: "#5B4CFF",
          tabBarInactiveTintColor: "#596078"
        }}
      >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
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
        name="create"
        options={{
          title: "Create",
          tabBarLabel: () => null,
          tabBarButton: () => (
            <Pressable
              style={s.createButton}
              onPress={() => setCreateOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Create"
            >
              <Ionicons name="add" size={36} color="#FFFFFF" />
            </Pressable>
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
        name="linqa"
        options={{
          title: "Linqa",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen name="communities" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="media" options={{ href: null }} />
      </Tabs>

      <QuickCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        actions={actions}
        contextLabel={pathname === "/" || pathname.includes("home") ? "Start something new in Linqa" : "Actions for this part of Linqa"}
        onAction={(key) => {
          const selected = actions.find((item) => item.key === key);
          setCreateOpen(false);
          if (selected) router.push(selected.route as never);
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  header: {
    height: 52,
    paddingTop: 4,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E7E9F2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  brand: { color: "#10132E", fontWeight: "900", fontSize: 19 },
  avatarBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  avatarLabel: { color: "#596078", fontSize: 12, fontWeight: "700" },
  tabBar: {
    height: 72,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: "#FFFFFF",
    borderTopColor: "#E8EAF2",
    borderTopWidth: 1,
    elevation: 12,
    shadowColor: "#171B4A",
    shadowOpacity: 0.09,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 }
  },
  tabLabel: { fontSize: 11, fontWeight: "700" },
  createButton: {
    alignSelf: "center",
    top: -17,
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5B4CFF",
    borderWidth: 5,
    borderColor: "#F7F7FC",
    shadowColor: "#5B4CFF",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8
  },
  guard: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }
});
