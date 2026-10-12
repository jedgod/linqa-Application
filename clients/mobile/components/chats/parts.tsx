import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "../LinearGradient";
import { chatTimeLabel, scheduledCallLabel, scheduledCallWhen, type ChatFilter, type ChatInboxPayload, type ChatSummary, type PresenceContact } from "../../services/chat-inbox.service";
import { C, s } from "./styles";

export const FILTER_LABELS: Record<ChatFilter, string> = {
  all: "All",
  unread: "Unread",
  groups: "Groups",
  pinned: "Favorites",
  archived: "Archived"
};

/** Gradient pairs for initial avatars, picked deterministically from the id. */
export const AVATAR_GRADIENTS: Array<[string, string]> = [
  ["#F47A54", "#C83DD4"],
  ["#B9D948", "#5FBF3A"],
  ["#C455F0", "#7B3FE4"],
  ["#FF6F7D", "#E8425C"],
  ["#4FB6F5", "#3D63E4"],
  ["#25C9A6", "#12857A"]
];

export function gradientFor(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]!;
}

export function Avatar({
  seed,
  initials,
  size = 54,
  online = false,
  ring
}: {
  seed: string;
  initials: string;
  size?: number;
  online?: boolean;
  ring?: string;
}) {
  const [from, to] = gradientFor(seed);
  return (
    <View style={ring ? [s.avatarRing, { borderColor: ring, borderRadius: size / 2 + 5 }] : undefined}>
      <LinearGradient
        colors={[from, to]}
        style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <Text style={[s.avatarText, { fontSize: size * 0.34 }]}>{initials || "?"}</Text>
      </LinearGradient>
      {online ? <View style={[s.onlineDot, { right: size * 0.02, bottom: size * 0.02 }]} /> : null}
    </View>
  );
}

/** Overlapping initial circles for a group row, as in the design. */
export function GroupAvatar({ seed, members }: { seed: string; members: string[] }) {
  const shown = members.slice(0, 3);
  if (shown.length === 0) return <Avatar seed={seed} initials="#" />;
  return (
    <View style={s.groupAvatar}>
      {shown.map((initials, index) => {
        const [from, to] = gradientFor(`${seed}-${initials}-${index}`);
        return (
          <LinearGradient
            key={`${initials}-${index}`}
            colors={[from, to]}
            style={[
              s.groupAvatarPiece,
              index === 0 && { top: 0, left: 0 },
              index === 1 && { top: 0, right: 0 },
              index === 2 && { bottom: 0, alignSelf: "center" }
            ]}
          >
            <Text style={s.groupAvatarText}>{initials}</Text>
          </LinearGradient>
        );
      })}
    </View>
  );
}

export function HeaderButton({
  label,
  icon,
  onPress,
  primary = false,
  dot = false
}: {
  label: string;
  icon: string;
  onPress: () => void;
  primary?: boolean;
  dot?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.headerButton, primary && s.headerButtonPrimary, pressed && s.pressed]}
    >
      <Ionicons name={icon as never} size={21} color={primary ? C.bg : C.white} />
      {dot ? <View style={s.headerDot} /> : null}
    </Pressable>
  );
}

export function SummaryCard({
  unreadTotal,
  scheduledCall,
  onJoin
}: {
  unreadTotal: number;
  scheduledCall: ChatInboxPayload["scheduledCall"];
  onJoin: () => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <View style={s.summary}>
      <View style={s.summaryTop}>
        <Avatar seed="me" initials="YO" size={62} online />
        <View style={s.summaryBody}>
          <Text style={s.greeting}>{greeting}</Text>
          <Text style={s.welcome}>Welcome back</Text>
          <Text style={s.summaryMeta}>
            {unreadTotal} unread
            {scheduledCall ? " · 1 call scheduled" : " · no calls scheduled"}
          </Text>
        </View>
      </View>

      {scheduledCall ? (
        <View style={s.scheduleCard}>
          <View style={s.scheduleIcon}>
            <Ionicons name="calendar-outline" size={17} color={C.purple} />
          </View>
          <View style={s.scheduleBody}>
            <Text style={s.scheduleTitle} numberOfLines={1}>
              {scheduledCallLabel(scheduledCall)}
            </Text>
            <Text style={s.scheduleWhen}>{scheduledCallWhen(scheduledCall)}</Text>
          </View>
          {/* Disabled outside the server's window: `joinable` is not a
              client-side time comparison. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Join scheduled call"
            accessibilityState={{ disabled: !scheduledCall.joinable }}
            disabled={!scheduledCall.joinable}
            onPress={onJoin}
            style={[s.joinButton, !scheduledCall.joinable && s.joinButtonDisabled]}
          >
            <Text style={[s.joinText, !scheduledCall.joinable && s.joinTextDisabled]}>Join</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function PresenceStrip({
  contacts,
  onStatus,
  onContact
}: {
  contacts: PresenceContact[];
  onStatus: () => void;
  onContact: (userId: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.presenceContent}
    >
      <Pressable onPress={onStatus} style={s.presenceItem} accessibilityLabel="Add my status">
        <View style={s.statusCircle}>
          <Ionicons name="add" size={26} color={C.teal} />
        </View>
        <Text style={s.presenceName}>My status</Text>
      </Pressable>
      {contacts.map((contact) => (
        <Pressable
          key={contact.userId}
          onPress={() => onContact(contact.userId)}
          style={s.presenceItem}
          accessibilityLabel={`${contact.displayName}${contact.online ? ", online" : ""}`}
        >
          <Avatar
            seed={contact.userId}
            initials={contact.initials}
            size={58}
            online={contact.online}
            ring={contact.online ? C.teal : C.border}
          />
          <Text numberOfLines={1} style={s.presenceName}>
            {contact.displayName.split(" ")[0]}
          </Text>
        </Pressable>
      ))}
      {contacts.length === 0 ? (
        <View style={s.presenceEmpty}>
          <Text style={s.presenceEmptyText}>People you message appear here.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

export function ConversationRow({
  item,
  onOpen,
  onLongPress,
  onCall
}: {
  item: ChatSummary;
  onOpen: () => void;
  onLongPress?: () => void;
  onCall: (peerUserId: string, callType: "AUDIO" | "VIDEO", peerName: string) => void;
}) {
  const previewIcon =
    item.previewKind === "voice" ? "mic-outline" : item.missedCall ? "call-outline" : null;
  const unreadLabel =
    item.unreadCount > 0
      ? `, ${item.unreadCount} unread message${item.unreadCount === 1 ? "" : "s"}`
      : "";

  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityHint={onLongPress ? "Long press for favorite, archive and lists" : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${item.pinned ? ", favorite" : ""}${unreadLabel}`}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      {item.isGroup && item.participantInitials.length > 1 ? (
        <GroupAvatar seed={item.conversationId} members={item.participantInitials} />
      ) : (
        <Avatar seed={item.conversationId} initials={item.initials} online={item.online} />
      )}

      <View style={s.rowBody}>
        <View style={s.rowTitleLine}>
          <Text numberOfLines={1} style={s.rowTitle}>
            {item.title}
          </Text>
          {item.pinned ? <Ionicons name="star" size={14} color="#E8A317" /> : null}
          {item.scheduledEvent ? <Ionicons name="calendar" size={14} color={C.purple} /> : null}
          {item.muted ? <Ionicons name="notifications-off-outline" size={14} color={C.muted} /> : null}
          {item.missedCall ? <Ionicons name="call" size={14} color={C.red} /> : null}
          <Text style={s.rowTime}>{chatTimeLabel(item.updatedAt)}</Text>
        </View>

        <View style={s.previewLine}>
          {previewIcon ? (
            <Ionicons
              name={previewIcon as never}
              size={13}
              color={item.missedCall ? C.red : C.muted}
            />
          ) : null}
          <Text numberOfLines={1} style={[s.preview, item.typingLabel ? s.typing : null]}>
            {item.typingLabel ?? item.preview ?? "No messages yet"}
          </Text>
          {item.previewKind === "voice" && item.previewDurationSeconds ? (
            <Text style={s.voiceDuration}>
              {Math.floor(item.previewDurationSeconds / 60)}:
              {String(item.previewDurationSeconds % 60).padStart(2, "0")}
            </Text>
          ) : null}
        </View>

        {/* Only rendered when there is something to say -- an always-present
            empty line would pad every row by a text height for nothing. */}
        {item.e2eeVerified || item.deliveryState === "read" ? (
          <View style={s.metaLine}>
            {/* Shown only on a server-verified ratchet, never as decoration. */}
            {item.e2eeVerified ? (
              <>
                <Ionicons name="lock-closed" size={11} color={C.muted} />
                <Text style={s.metaText}>End-to-end encrypted</Text>
              </>
            ) : null}
            {item.deliveryState === "read" ? (
              <Ionicons name="checkmark-done" size={14} color={C.cyan} />
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={s.rowTail}>
        {item.unreadCount > 0 ? (
          <View style={s.unread}>
            <Text style={s.unreadText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
          </View>
        ) : null}
        {/* Direct conversations only: a group call needs a roster this screen
            does not hold. */}
        {item.peerUserId ? (
          <View style={s.rowActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Audio call ${item.title}`}
              hitSlop={6}
              onPress={() => onCall(item.peerUserId!, "AUDIO", item.title)}
              style={({ pressed }) => [s.rowAction, pressed && s.pressed]}
            >
              <Ionicons name="call-outline" size={15} color={C.teal} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Video call ${item.title}`}
              hitSlop={6}
              onPress={() => onCall(item.peerUserId!, "VIDEO", item.title)}
              style={({ pressed }) => [s.rowAction, pressed && s.pressed]}
            >
              <Ionicons name="videocam-outline" size={15} color={C.cyan} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
