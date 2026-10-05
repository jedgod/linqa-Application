import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useAccounts } from "../account/AccountContext";
import { useTheme } from "../theme/tokens";

/** Fresh installs land on the welcome screen; existing accounts resume at onboarding resolve. */
export default function Index() {
  const { colors } = useTheme();
  const { loaded, accounts } = useAccounts();

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return <Redirect href={accounts.length === 0 ? "/welcome" : "/onboarding/resolve"} />;
}
