import { Redirect, useLocalSearchParams, type Href } from "expo-router";
import { ModuleRouteScreen } from "../../components/ModuleRouteScreen";

// These modules have their own screens. The generic action list is for modules that don't yet.
const OWN_SCREEN: Record<string, Href> = { notes: "/notes", calendar: "/calendar", enterprise: "/enterprise" };

export default function ModuleScreen() {
  const { moduleKey } = useLocalSearchParams<{ moduleKey: string }>();
  const own = OWN_SCREEN[moduleKey ?? ""];
  if (own) return <Redirect href={own} />;
  return <ModuleRouteScreen moduleKey={moduleKey} />;
}