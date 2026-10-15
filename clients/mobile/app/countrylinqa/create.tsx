// Create post / Create event. The screen itself is the supplied linqa-publishing interface; this route connects it to the
// app's session and navigation. Closing, or finishing, returns to Home.
import { useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAccounts } from "../../account/AccountContext";
import CreateEventConnected from "../../components/publishing/CreateEventConnected";
import { afterPublished, publishingConfig } from "../../lib/publishing/integration";

export default function CreateScreen() {
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type?: string }>();
  const { active } = useAccounts();
  const config = useMemo(() => publishingConfig(), []);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F8F8F6" }}>
      <CreateEventConnected
        config={config}
        heading={type === "event" ? "Create Event" : "Create Post"}
        onClose={() => router.replace("/(tabs)/home")}
        onPublished={({ localId, payload }) => (active ? afterPublished(active.userId, localId, payload) : undefined)}
      />
    </SafeAreaView>
  );
}
