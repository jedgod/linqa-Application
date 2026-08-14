import { useLocalSearchParams } from "expo-router";
import { ModuleRouteScreen } from "../../components/ModuleRouteScreen";

export default function ModuleScreen() {
  const { moduleKey } = useLocalSearchParams<{ moduleKey: string }>();
  return <ModuleRouteScreen moduleKey={moduleKey} />;
}