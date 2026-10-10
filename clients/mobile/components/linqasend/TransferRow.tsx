import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LinqaSendTransferSummary } from "../../services/linqasend.service";
import { fonts } from "../../theme/tokens";
import { whenLabel } from "./TrackingTimeline";
import { Avatar, formatMinor, send } from "./ui";

const STATUS: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: "Completed", color: send.success },
  DECLINED: { label: "Declined", color: send.danger },
  FAILED: { label: "Failed", color: send.danger },
  CANCELED: { label: "Canceled", color: send.muted },
  EXPIRED: { label: "Expired", color: send.muted },
  REFUNDED: { label: "Refunded", color: send.muted },
  REVERSED: { label: "Reversed", color: send.muted }
};

export function statusOf(status: string): { label: string; color: string } {
  return STATUS[status] ?? { label: "In progress", color: send.warning };
}

/** "GHS 5,319.00" for other currencies, "$300.00" for dollars. Shows what the recipient gets. */
export function transferAmount(item: Pick<LinqaSendTransferSummary, "receiveAmountMinor" | "receiveCurrency">): string {
  return item.receiveCurrency === "USD" ? `$${formatMinor(item.receiveAmountMinor)}` : `${item.receiveCurrency} ${formatMinor(item.receiveAmountMinor)}`;
}

/** Finished transfers open their receipt; anything still moving opens live tracking. */
export function transferRoute(item: Pick<LinqaSendTransferSummary, "id" | "status">) {
  return { pathname: item.status === "COMPLETED" ? "/linqasend/receipt" : "/linqasend/status", params: { id: item.id } } as const;
}

export function TransferRow({ item, onPress, showAvatar = false }: { item: LinqaSendTransferSummary; onPress: () => void; showAvatar?: boolean }) {
  const status = statusOf(item.status);
  const received = item.direction === "RECEIVED";
  const when = whenLabel(item.completedAt ?? item.createdAt) ?? "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${received ? "From" : "To"} ${item.recipientName}, ${transferAmount(item)}, ${status.label}, ${when}`}
      style={s.row}
      onPress={onPress}
    >
      {showAvatar ? <Avatar name={item.recipientName} size={46} /> : null}
      <View style={s.text}>
        <Text style={s.title} numberOfLines={1}>{received ? "From" : "To"} {item.recipientName}</Text>
        <Text style={s.meta}>{when}</Text>
      </View>
      <View style={s.right}>
        <Text style={s.amount}>{transferAmount(item)}</Text>
        <Text style={[s.status, { color: status.color }]}>{status.label}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: send.border },
  text: { flex: 1 },
  title: { color: send.text, fontFamily: fonts.semibold, fontSize: 15 },
  meta: { color: send.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 4 },
  right: { alignItems: "flex-end" },
  amount: { color: send.text, fontFamily: fonts.bold, fontSize: 15 },
  status: { fontFamily: fonts.medium, fontSize: 13, marginTop: 4 }
});
