import React from "react";
import { useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAccounts } from "../../account/AccountContext";
import { resolveTheme } from "../../services/conversation-engine";
import { WallpaperPicker } from "../../components/conversation/WallpaperPicker";
import { useWallpaper } from "../../components/conversation/useWallpaper";

/** The person's default chat wallpaper, used by every chat that has not been given its own. */
export default function WallpaperSettingsScreen() {
  const router = useRouter();
  const { active } = useAccounts();
  const theme = resolveTheme("system", useColorScheme());
  const state = useWallpaper(active?.userId ?? "", undefined);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surface }}>
      <WallpaperPicker key={active?.userId ?? "none"} theme={theme} state={state} scope="default" onBack={() => router.back()} />
    </SafeAreaView>
  );
}
