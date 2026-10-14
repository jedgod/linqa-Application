// Keeps the bottom of a sheet or form clear of the phone's own buttons (back, home, recent apps).
//
// A React Native Modal is its own window on Android, so it has to carry its own safe-area provider for the app to know
// where the system bars are; without one the sheet's last row or its main button draws underneath them. Wrap the
// Modal's contents in <ModalSafe> and end the sheet with <BottomInsetSpacer />.

import React from "react";
import { View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

export function ModalSafe({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider style={{ flex: 1 }}>{children}</SafeAreaProvider>;
}

/** Empty space as tall as the system navigation area, plus a little breathing room. */
export function BottomInsetSpacer({ min = 12, extra = 16 }: { min?: number; extra?: number }) {
  const insets = useSafeAreaInsets();
  return <View pointerEvents="none" style={{ height: Math.max(insets.bottom, min) + extra }} />;
}
