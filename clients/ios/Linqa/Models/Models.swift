import Foundation

// UI-facing models. These will later map to the UniFFI-generated types from
// linqa-core (IdentityId, DeviceId, LinkedDevice, etc.) — kept as plain
// Swift structs for now so the UI shell has something to render.

struct Contact: Identifiable, Hashable {
    let id: String
    let displayName: String
    let initials: String
    let colorHue: Double
    let online: Bool
    let fingerprint: String
}

enum MessageStatus {
    case sending, sent, delivered, read

    var glyph: String {
        switch self {
        case .sending: return "○"
        case .sent: return "✓"
        case .delivered, .read: return "✓✓"
        }
    }
}

struct Message: Identifiable, Hashable {
    let id: String
    let conversationId: String
    let senderId: String
    let text: String
    let sentAt: Date
    var status: MessageStatus
    let isMine: Bool

    static func == (lhs: Message, rhs: Message) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct Conversation: Identifiable, Hashable {
    let id: String
    let isGroup: Bool
    let title: String
    let participantIds: [String]
    let unreadCount: Int
    let pinned: Bool
    let muted: Bool

    static func == (lhs: Conversation, rhs: Conversation) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

enum DevicePlatform {
    case android, ios, desktop, web

    var icon: String {
        switch self {
        case .android, .ios: return "📱"
        case .desktop: return "🖥"
        case .web: return "🌐"
        }
    }
}

struct LinkedDevice: Identifiable, Hashable {
    let id: String
    let name: String
    let platform: DevicePlatform
    let linkedAt: Date
    let lastActive: Date
    let isCurrent: Bool
}

struct Profile: Hashable {
    let displayName: String
    let username: String
    let fingerprint: String
    let pqEnabled: Bool
}
