import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { blendColors } from "./blendColors";

type Point = { x: number; y: number };

/**
 * Stand-in for expo-linear-gradient's <LinearGradient>, with the same props, that
 * needs NO native view.
 *
 * The development build installed on the test phone does not contain the native
 * ExpoLinearGradient view, and its react-native-svg build cannot render a gradient
 * either (both fail with "Can't find ViewManager ..."). Any screen using the real
 * component showed a red error screen, which is why the Calls and Chats tabs
 * "kept breaking". This renders the blended color instead, so those screens work
 * on any build. Once a build that includes expo-linear-gradient is installed, swap
 * this component's body back to the real one; call sites do not change.
 */
export function LinearGradient({
  colors,
  style,
  children
}: {
  colors: readonly string[];
  start?: Point;
  end?: Point;
  locations?: readonly number[] | null;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return <View style={[style, { backgroundColor: blendColors(colors) }]}>{children}</View>;
}
