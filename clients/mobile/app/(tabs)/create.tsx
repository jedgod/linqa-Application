import { View } from "react-native";

// The center navigation control opens the contextual create sheet and never
// navigates here. This route exists so Expo Router can register the tab safely.
export default function CreateRoute() {
  return <View />;
}
