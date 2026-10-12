import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Modal, Pressable, Text, View } from "react-native";
import { useAccounts } from "../account/AccountContext";
import { exportHistory, historyTransfers, HistoryTransferCancelled, type ExportProgress, type PendingTransfer } from "../services/history-transfer";
import { useTheme } from "../theme/tokens";

const POLL_MS = 8_000;
const PHASE_TEXT: Record<ExportProgress["phase"], string> = {
  preparing: "Preparing",
  reading: "Reading your messages",
  sending: "Sending to your computer",
  finishing: "Finishing"
};

/**
 * Watches for a linked computer asking for older messages. The person decides on the phone; nothing leaves the phone before they do.
 * Only one request is handled at a time.
 */
export function HistoryTransferHost() {
  const { active, loaded } = useAccounts();
  const { colors } = useTheme();
  const busy = useRef(false);
  const cancelled = useRef(false);
  const asked = useRef(new Set<string>());
  const [running, setRunning] = useState<{ name: string; progress: ExportProgress } | null>(null);

  useEffect(() => {
    if (!loaded || !active) return;
    const selfId = active.userId;
    let stopped = false;

    const run = async (item: PendingTransfer) => {
      busy.current = true;
      cancelled.current = false;
      setRunning({ name: item.computerName, progress: { phase: "preparing", done: 0, total: 1 } });
      try {
        const { computerDeviceId } = await historyTransfers.approve(item.id);
        const result = await exportHistory({
          selfId, transferId: item.id, computerDeviceId,
          isCancelled: () => cancelled.current,
          onProgress: (progress) => setRunning({ name: item.computerName, progress })
        });
        setRunning(null);
        Alert.alert("History sent", `${result.messages} messages went to ${item.computerName}.`);
      } catch (error) {
        setRunning(null);
        if (error instanceof HistoryTransferCancelled) {
          await historyTransfers.cancel(item.id).catch(() => undefined);
          return;
        }
        const code = (error as Error).message || "FAILED";
        await historyTransfers.fail(item.id, code.slice(0, 40)).catch(() => undefined);
        Alert.alert("Couldn't send history", "Something went wrong while sending. Ask your computer to try again.");
      } finally {
        busy.current = false;
      }
    };

    const check = async () => {
      if (stopped || busy.current || AppState.currentState !== "active") return;
      let items: PendingTransfer[];
      try { items = await historyTransfers.pending(); } catch { return; }
      const next = items.find((i) => !asked.current.has(i.id));
      if (!next || stopped) return;
      asked.current.add(next.id);
      busy.current = true;
      Alert.alert(
        "Send message history?",
        `${next.computerName} is asking for your older messages. They are sealed on this phone for that computer only.`,
        [
          { text: "Not now", style: "cancel", onPress: () => { busy.current = false; void historyTransfers.decline(next.id).catch(() => undefined); } },
          { text: "Send", onPress: () => { busy.current = false; void run(next); } }
        ],
        { cancelable: false }
      );
    };

    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") void check(); });
    return () => { stopped = true; clearInterval(timer); sub.remove(); };
  }, [active, loaded]);

  const progress = running?.progress;
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <Modal visible={running !== null} transparent animationType="fade" onRequestClose={() => { cancelled.current = true; }}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, width: "100%", maxWidth: 360 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>Sending history to {running?.name}</Text>
          <Text style={{ color: colors.textMuted, marginTop: 6 }}>{progress ? PHASE_TEXT[progress.phase] : ""}{progress && progress.phase !== "preparing" ? ` Â· ${percent}%` : ""}</Text>
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          <Pressable accessibilityRole="button" onPress={() => { cancelled.current = true; }} style={{ alignSelf: "flex-end", padding: 8 }}>
            <Text style={{ color: colors.accent, fontWeight: "700" }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

