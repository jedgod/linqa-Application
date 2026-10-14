import { StyleSheet } from "react-native";
import { fonts } from "../../theme/tokens";

/** Chats runs on the dark surface from the approved design. */
export const C = {
  bg: "#031824",
  card: "#082335",
  card2: "#0A2940",
  border: "#14536A",
  divider: "#0F3548",
  teal: "#13D7B0",
  cyan: "#47C9E8",
  white: "#F7FAFC",
  muted: "#91A7B8",
  blue: "#4586FF",
  purple: "#BB54EA",
  red: "#FF5D67"
} as const;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pressed: { opacity: 0.72 },

  header: {
    minHeight: 62,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7
  },
  brand: { color: C.white, fontFamily: fonts.extrabold, fontSize: 25, marginLeft: 8 },
  headerSpacer: { flex: 1 },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center"
  },
  headerButtonPrimary: { backgroundColor: C.teal, borderColor: C.teal },
  headerDot: {
    position: "absolute",
    right: -2,
    top: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.teal,
    borderWidth: 2,
    borderColor: C.bg
  },

  hubScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 15 },
  actionHub: {
    position: "absolute",
    zIndex: 20,
    top: 62,
    right: 14,
    width: 300,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card2,
    flexDirection: "row",
    flexWrap: "wrap",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14
  },
  hubItem: { width: "33.333%", minHeight: 82, alignItems: "center", justifyContent: "center", gap: 7 },
  hubLabel: { color: C.white, fontSize: 12.5, fontFamily: fonts.semibold, textAlign: "center" },

  list: { paddingHorizontal: 14, paddingBottom: 32, gap: 9 },

  summary: {
    overflow: 'hidden',
    minHeight: 128,
    marginTop: 6,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card
  },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryBody: { flex: 1 },
  greeting: { color: '#D5E6EC', fontSize: 12.5, fontFamily: fonts.regular },
  welcome: { color: C.white, fontSize: 21, fontFamily: fonts.extrabold, marginTop: 1 },
  summaryMeta: { color: C.teal, marginTop: 3, fontSize: 12, fontFamily: fonts.semibold },
  scheduleCard: {
    marginTop: 12,
    padding: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.divider,
    backgroundColor: C.card2,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  scheduleIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: "#221A3C",
    alignItems: "center",
    justifyContent: "center"
  },
  scheduleBody: { flex: 1 },
  scheduleTitle: { color: C.white, fontSize: 13.5, fontFamily: fonts.bold },
  scheduleWhen: { color: C.muted, fontSize: 12.5, fontFamily: fonts.regular, marginTop: 2 },
  joinButton: {
    paddingHorizontal: 17,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: C.teal
  },
  joinButtonDisabled: { backgroundColor: C.divider },
  joinText: { color: C.bg, fontFamily: fonts.extrabold, fontSize: 13 },
  joinTextDisabled: { color: C.muted },

  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: C.white, fontFamily: fonts.extrabold },
  avatarRing: { borderWidth: 2, padding: 3 },
  onlineDot: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.teal,
    borderWidth: 2.5,
    borderColor: C.bg
  },
  groupAvatar: { width: 54, height: 54 },
  groupAvatarPiece: {
    position: "absolute",
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.card
  },
  groupAvatarText: { color: C.white, fontSize: 12, fontFamily: fonts.extrabold },

  presenceContent: { paddingVertical: 14, gap: 16, alignItems: "flex-start" },
  presenceItem: { width: 66, alignItems: "center", gap: 7 },
  presenceName: {
    color: C.white,
    width: 66,
    textAlign: "center",
    fontFamily: fonts.semibold,
    fontSize: 12.5
  },
  statusCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: C.teal,
    alignItems: "center",
    justifyContent: "center",
    margin: 5
  },
  presenceEmpty: { height: 68, justifyContent: "center", paddingLeft: 4 },
  presenceEmptyText: { color: C.muted, fontSize: 12, fontFamily: fonts.regular },

  filters: {
    padding: 4,
    flexDirection: "row",
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12
  },
  filter: {
    paddingHorizontal: 12,
    minHeight: 40,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6
  },
  filterActive: { backgroundColor: "#0B4A48" },
  filterText: { color: C.muted, fontFamily: fonts.bold, fontSize: 12.5 },
  filterTextActive: { color: C.teal },
  filterCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: "#173D52",
    alignItems: "center",
    justifyContent: "center"
  },
  filterCountActive: { backgroundColor: C.teal },
  filterCountText: { color: C.white, fontFamily: fonts.extrabold, fontSize: 12 },
  filterCountTextActive: { color: C.bg },

  row: {
    minHeight: 88,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  rowBody: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { flex: 1, color: C.white, fontFamily: fonts.extrabold, fontSize: 15.5 },
  rowTime: { color: C.muted, fontSize: 12.5, fontFamily: fonts.regular },
  previewLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  preview: { flex: 1, color: C.muted, fontSize: 13, fontFamily: fonts.regular },
  typing: { color: C.teal, fontFamily: fonts.bold },
  voiceDuration: { color: C.muted, fontSize: 12, fontFamily: fonts.regular },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowTail: { alignItems: "flex-end", justifyContent: "center", gap: 8 },
  rowActions: { flexDirection: "row", gap: 6 },
  rowAction: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.divider,
    backgroundColor: C.card2,
    alignItems: "center",
    justifyContent: "center"
  },
  metaText: { color: C.muted, fontSize: 12.5, fontFamily: fonts.regular },
  unread: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    backgroundColor: C.teal,
    alignItems: "center",
    justifyContent: "center"
  },
  unreadText: { color: C.bg, fontFamily: fonts.extrabold, fontSize: 12 },

  loader: { marginTop: 36 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 44, gap: 9 },
  emptyText: { color: C.muted, fontSize: 13, fontFamily: fonts.regular },
  errorCard: {
    marginBottom: 12,
    padding: 11,
    borderRadius: 11,
    backgroundColor: "#3A1620",
    borderWidth: 1,
    borderColor: "#7A2733",
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  errorText: { flex: 1, color: "#FFC2C8", fontSize: 12, fontFamily: fonts.regular },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: C.border,
    padding: 18,
    maxHeight: "70%"
  },
  modalTitle: { color: C.white, fontSize: 17, fontFamily: fonts.extrabold, marginBottom: 14 },
  modalScroll: { flexGrow: 0 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.divider
  },
  contactName: { flex: 1, color: C.white, fontSize: 14, fontFamily: fonts.semibold },
  modalHint: { color: C.muted, fontSize: 12.5, fontFamily: fonts.regular, paddingVertical: 12 },
  modalCancel: { marginTop: 14, alignItems: "center", paddingVertical: 10 },
  modalCancelText: { color: C.muted, fontFamily: fonts.bold, fontSize: 14 }
});
