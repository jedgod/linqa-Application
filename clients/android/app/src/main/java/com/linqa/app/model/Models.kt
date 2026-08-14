package com.linqa.app.model

data class Contact(
    val id: String,
    val displayName: String,
    val initials: String,
    val colorHue: Int,
    val online: Boolean,
    val fingerprint: String,
    val statusBody: String? = null,
)

enum class MessageStatus { SENDING, SENT, DELIVERED, READ }

data class Message(
    val id: String,
    val conversationId: String,
    val senderId: String,
    val text: String,
    val sentAt: Long,
    val status: MessageStatus,
    val isMine: Boolean,
)

data class Conversation(
    val id: String,
    val isGroup: Boolean,
    val title: String,
    val participantIds: List<String>,
    val unreadCount: Int,
    val pinned: Boolean,
    val muted: Boolean,
    val lastMessagePreview: String = "No messages yet",
    val lastMessageAt: Long = 0L,
)

data class StatusUpdate(val id: String, val body: String, val createdAt: Long)

data class CallRecord(
    val id: String,
    val peerName: String,
    val direction: String,
    val callType: String,
    val status: String,
    val createdAt: Long,
)

data class CommunityRecord(val id: String, val name: String, val role: String, val visibility: String)

data class MediaRecord(
    val id: String,
    val mediaType: String,
    val conversationTitle: String,
    val starred: Boolean,
    val createdAt: Long,
)

data class HubSnapshot(
    val profile: Profile,
    val contacts: List<Contact>,
    val conversations: List<Conversation>,
    val statuses: List<StatusUpdate>,
    val calls: List<CallRecord>,
    val communities: List<CommunityRecord>,
    val media: List<MediaRecord>,
    val devices: List<LinkedDevice>,
)

enum class DevicePlatform { ANDROID, IOS, DESKTOP, WEB }

data class LinkedDevice(
    val id: String,
    val name: String,
    val platform: DevicePlatform,
    val linkedAt: Long,
    val lastActive: Long,
    val isCurrent: Boolean,
)

data class Profile(
    val displayName: String,
    val username: String,
    val fingerprint: String,
    val pqEnabled: Boolean,
)
