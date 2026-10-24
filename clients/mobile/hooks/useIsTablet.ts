import { useWindowDimensions } from "react-native";
import { navigationMode, type NavigationMode } from "../navigation/breadcrumbs";

/** Shorter side must reach this for the window to count as a tablet at all (dp). */
export const TABLET_MIN_SHORT_SIDE = 600;

/**
 * Layout mode for the current window. Width picks the tablet tier so split
 * screen reflows; the shorter-side check keeps a phone turned sideways a phone.
 */
export function useNavigationMode(): NavigationMode {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height) >= TABLET_MIN_SHORT_SIDE ? navigationMode(width) : "mobile";
}

export function useIsTablet(): boolean {
  return useNavigationMode() !== "mobile";
}
