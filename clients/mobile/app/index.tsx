import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useAccounts } from "../account/AccountContext";
import { colors } from "../theme/tokens";

/**
 * 2026-08-07 fix: nothing redirected the app's root path ("/") anywhere,
 * so a cold launch (and every "relaunch the app" the user tried) hit
 * Expo Router's "Unmatched Route" 404 screen instead of the Calls tab —
 * confirmed by reproducing it directly, on both web and a real Android
 * device. (tabs)/_layout.tsx registers "calls" first, so that's the
 * closest thing this app has to a home screen today.
 *
 * 2026-08-10 addition: that fix always redirected to tabs/home, even on a
 * completely fresh install with zero local accounts — there was no
 * landing/welcome screen at all, and no way to reach account creation
 * except by already knowing the /account/sign-up URL. Now gated on the
 * real AccountContext's persisted account list instead of unconditionally
 * skipping past it.
 */
export default function Index() {
  const { loaded, accounts } = useAccounts();

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return <Redirect href={accounts.length === 0 ? "/welcome" : "/(tabs)/home"} />;
}
