import Foundation

/// In-memory mock data standing in for linqa-core. Nothing here is
/// persisted or encrypted — it exists purely so the UI shell has something
/// real to render before the Rust core is buildable and linked via UniFFI.
enum MockData {
    static let meId = "me"

    static let profile = Profile(
        displayName: "You",
        username: "@you.linqa",
        fingerprint: "8F2C 91AA 4D6E 0B77 1F3A  6C90 2E5D 44B1",
        pqEnabled: true
    )

    static let contacts: [Contact] = [
        Contact(id: "u-avery", displayName: "Avery Chen", initials: "AC", colorHue: 262, online: true, fingerprint: "3A1B 77CE 90F2 118D"),
        Contact(id: "u-lin", displayName: "Lin Ochoa", initials: "LO", colorHue: 199, online: false, fingerprint: "5D40 22AB CC91 7702"),
        Contact(id: "u-priya", displayName: "Priya Nair", initials: "PN", colorHue: 154, online: true, fingerprint: "F013 9BDE 4471 A0C2"),
        Contact(id: "u-marcus", displayName: "Marcus Webb", initials: "MW", colorHue: 24, online: false, fingerprint: "77AC 0FE1 2D8B 5599"),
        Contact(id: "u-sana", displayName: "Sana Rehman", initials: "SR", colorHue: 330, online: true, fingerprint: "B821 4471 0E9C 3FA0"),
    ]

    static let conversations: [Conversation] = [
        Conversation(id: "c-avery", isGroup: false, title: "Avery Chen", participantIds: ["u-avery"], unreadCount: 2, pinned: true, muted: false),
        Conversation(id: "c-design", isGroup: true, title: "Design Sync", participantIds: ["u-lin", "u-priya", "u-marcus"], unreadCount: 0, pinned: false, muted: false),
        Conversation(id: "c-lin", isGroup: false, title: "Lin Ochoa", participantIds: ["u-lin"], unreadCount: 0, pinned: false, muted: false),
        Conversation(id: "c-priya", isGroup: false, title: "Priya Nair", participantIds: ["u-priya"], unreadCount: 5, pinned: false, muted: false),
        Conversation(id: "c-sana", isGroup: false, title: "Sana Rehman", participantIds: ["u-sana"], unreadCount: 0, pinned: false, muted: true),
    ]

    private static let now = Date()
    private static func minutesAgo(_ n: Double) -> Date { now.addingTimeInterval(-n * 60) }

    static var messagesByConversation: [String: [Message]] = [
        "c-avery": [
            Message(id: "m1", conversationId: "c-avery", senderId: "u-avery", text: "Hey, did the new build land?", sentAt: minutesAgo(42), status: .read, isMine: false),
            Message(id: "m2", conversationId: "c-avery", senderId: meId, text: "Yep, just pushed. Should be up in ~10 min.", sentAt: minutesAgo(40), status: .read, isMine: true),
            Message(id: "m3", conversationId: "c-avery", senderId: "u-avery", text: "Nice. Are the PQC handshake changes in this one?", sentAt: minutesAgo(12), status: .read, isMine: false),
            Message(id: "m4", conversationId: "c-avery", senderId: "u-avery", text: "Also — can you sanity check the device linking flow before we ship?", sentAt: minutesAgo(3), status: .read, isMine: false),
        ],
        "c-design": [
            Message(id: "m5", conversationId: "c-design", senderId: "u-lin", text: "Updated the chat bubble spacing in the latest Figma.", sentAt: minutesAgo(180), status: .read, isMine: false),
            Message(id: "m6", conversationId: "c-design", senderId: "u-priya", text: "Looks good, one nit on the unread badge color.", sentAt: minutesAgo(120), status: .read, isMine: false),
            Message(id: "m7", conversationId: "c-design", senderId: meId, text: "Fixed, pushing a new export now.", sentAt: minutesAgo(90), status: .delivered, isMine: true),
        ],
        "c-lin": [
            Message(id: "m8", conversationId: "c-lin", senderId: "u-lin", text: "Lunch tomorrow?", sentAt: minutesAgo(1560), status: .read, isMine: false),
            Message(id: "m9", conversationId: "c-lin", senderId: meId, text: "Sure, noon works.", sentAt: minutesAgo(1500), status: .read, isMine: true),
        ],
        "c-priya": [
            Message(id: "m10", conversationId: "c-priya", senderId: "u-priya", text: "Sent you the audit notes.", sentAt: minutesAgo(300), status: .read, isMine: false),
            Message(id: "m11", conversationId: "c-priya", senderId: "u-priya", text: "Section 4 has the sealed-sender questions.", sentAt: minutesAgo(240), status: .read, isMine: false),
            Message(id: "m12", conversationId: "c-priya", senderId: "u-priya", text: "No rush, just flagging before Friday.", sentAt: minutesAgo(240), status: .read, isMine: false),
            Message(id: "m13", conversationId: "c-priya", senderId: "u-priya", text: "Also — new fingerprint after your reinstall, verify when you get a sec.", sentAt: minutesAgo(20), status: .read, isMine: false),
            Message(id: "m14", conversationId: "c-priya", senderId: "u-priya", text: "🔒", sentAt: minutesAgo(19), status: .read, isMine: false),
        ],
        "c-sana": [
            Message(id: "m15", conversationId: "c-sana", senderId: "u-sana", text: "Meeting moved to 3pm.", sentAt: minutesAgo(1560), status: .read, isMine: false),
        ],
    ]

    static let devices: [LinkedDevice] = [
        LinkedDevice(id: "d-current", name: "This iPhone", platform: .ios, linkedAt: minutesAgo(43200), lastActive: now, isCurrent: true),
        LinkedDevice(id: "d-laptop", name: "MacBook Pro", platform: .desktop, linkedAt: minutesAgo(17280), lastActive: minutesAgo(3), isCurrent: false),
        LinkedDevice(id: "d-web", name: "Chrome — Web", platform: .web, linkedAt: minutesAgo(11520), lastActive: minutesAgo(45), isCurrent: false),
    ]

    static func contact(for id: String) -> Contact? {
        contacts.first { $0.id == id }
    }

    static func conversationSubtitle(_ conversationId: String) -> String {
        guard let last = messagesByConversation[conversationId]?.last else { return "No messages yet" }
        return (last.isMine ? "You: " : "") + last.text
    }

    static func lastMessageTime(_ conversationId: String) -> Date {
        messagesByConversation[conversationId]?.last?.sentAt ?? .distantPast
    }
}
