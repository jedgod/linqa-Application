import Foundation

/**
 * Thin bridge to the Rust linqa-core library (via UniFFI-generated bindings).
 *
 * Once UniFFI bindings are generated and the native library is linked, this
 * type will call into it directly. For now it is backed by in-memory mock
 * data (MockData.swift) so the UI shell has something real to render — the
 * async function shape mirrors the eventual real API so swapping the
 * implementation later shouldn't require UI changes.
 */
enum CoreBridge {

    static var isNativeLoaded: Bool { false }

    static func versionPlaceholder() -> String {
        "linqa-core not loaded (mock data backing the UI)"
    }

    static func getProfile() async -> Profile {
        try? await Task.sleep(nanoseconds: 120_000_000)
        return MockData.profile
    }

    static func listConversations() async -> [Conversation] {
        try? await Task.sleep(nanoseconds: 120_000_000)
        return MockData.conversations
    }

    static func listMessages(conversationId: String) async -> [Message] {
        try? await Task.sleep(nanoseconds: 120_000_000)
        return MockData.messagesByConversation[conversationId] ?? []
    }

    static func sendMessage(conversationId: String, text: String) async -> Message {
        var message = Message(
            id: "local-\(Date().timeIntervalSince1970)",
            conversationId: conversationId,
            senderId: MockData.meId,
            text: text,
            sentAt: Date(),
            status: .sending,
            isMine: true
        )
        MockData.messagesByConversation[conversationId, default: []].append(message)
        try? await Task.sleep(nanoseconds: 150_000_000)
        message.status = .sent
        if let idx = MockData.messagesByConversation[conversationId]?.firstIndex(where: { $0.id == message.id }) {
            MockData.messagesByConversation[conversationId]?[idx] = message
        }
        return message
    }

    static func listDevices() async -> [LinkedDevice] {
        try? await Task.sleep(nanoseconds: 120_000_000)
        return MockData.devices
    }

    static func beginDeviceLink() async -> String {
        try? await Task.sleep(nanoseconds: 200_000_000)
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        return (0..<4).map { _ in String((0..<4).map { _ in chars.randomElement()! }) }.joined(separator: "-")
    }
}
