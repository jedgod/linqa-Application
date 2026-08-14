package com.linqa.app.crypto

import com.linqa.app.BuildConfig
import com.linqa.app.model.CallRecord
import com.linqa.app.model.CommunityRecord
import com.linqa.app.model.Contact
import com.linqa.app.model.Conversation
import com.linqa.app.model.DevicePlatform
import com.linqa.app.model.HubSnapshot
import com.linqa.app.model.LinkedDevice
import com.linqa.app.model.MediaRecord
import com.linqa.app.model.Message
import com.linqa.app.model.MessageStatus
import com.linqa.app.model.Profile
import com.linqa.app.model.StatusUpdate
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

object CoreBridge {
    private val client = OkHttpClient()
    private val jsonMediaType = "application/json".toMediaType()
    private val localMessages = mutableMapOf<String, MutableList<Message>>()
    @Volatile private var snapshot: HubSnapshot? = null

    fun isNativeLoaded(): Boolean = NativeCore.isLoaded()

    fun versionPlaceholder(): String =
        if (NativeCore.isLoaded()) {
            "linqa-core ${NativeCore.version()}; conversation data still via dev/mobile-hub bridge"
        } else {
            "PostgreSQL development bridge; secure core not loaded"
        }

    suspend fun loadHub(): HubSnapshot = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${BuildConfig.HUB_BASE_URL}/v1/dev/mobile-hub")
            .demoHeader()
            .build()
        parseSnapshot(execute(request)).also { snapshot = it }
    }

    suspend fun getProfile(): Profile = snapshot?.profile ?: loadHub().profile

    suspend fun listConversations(): List<Conversation> = (snapshot ?: loadHub()).conversations

    suspend fun listMessages(conversationId: String): List<Message> =
        localMessages[conversationId]?.toList() ?: emptyList()

    suspend fun sendMessage(conversationId: String, text: String): Message {
        val sent = Message(
            id = "local-${System.currentTimeMillis()}",
            conversationId = conversationId,
            senderId = "me",
            text = text,
            sentAt = System.currentTimeMillis(),
            status = MessageStatus.SENT,
            isMine = true,
        )
        localMessages.getOrPut(conversationId) { mutableListOf() }.add(sent)
        return sent
    }

    suspend fun listDevices(): List<LinkedDevice> = (snapshot ?: loadHub()).devices

    suspend fun publishStatus(body: String) {
        post("/v1/dev/mobile-hub/statuses", JSONObject().put("body", body))
        loadHub()
    }

    suspend fun createConversation(recipientUserId: String): String {
        val response = post(
            "/v1/dev/mobile-hub/conversations",
            JSONObject().put("recipientUserId", recipientUserId),
        )
        loadHub()
        return response.getString("id")
    }

    suspend fun createCall(peerUserId: String, video: Boolean = false) {
        post(
            "/v1/dev/mobile-hub/calls",
            JSONObject()
                .put("peerUserId", peerUserId)
                .put("callType", if (video) "VIDEO" else "AUDIO"),
        )
        loadHub()
    }

    fun connectRealtime(onChanged: () -> Unit): WebSocket {
        val websocketUrl = BuildConfig.HUB_BASE_URL.replaceFirst("http", "ws") +
            "/v1/dev/mobile-hub/live"
        val request = Request.Builder().url(websocketUrl).demoHeader().build()
        return client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (JSONObject(text).optString("type") == "mobile-hub.changed") onChanged()
            }
        })
    }

    suspend fun beginDeviceLink(): String =
        "Enrollment unavailable until proof verification is connected"

    private suspend fun post(path: String, body: JSONObject): JSONObject =
        withContext(Dispatchers.IO) {
            execute(
                Request.Builder()
                    .url(BuildConfig.HUB_BASE_URL + path)
                    .demoHeader()
                    .post(body.toString().toRequestBody(jsonMediaType))
                    .build(),
            )
        }

    private fun execute(request: Request): JSONObject {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("Hub request failed (${response.code})")
            return JSONObject(body)
        }
    }

    private fun Request.Builder.demoHeader() = header("x-linqa-demo-user", "galaxy")

    private fun parseSnapshot(root: JSONObject): HubSnapshot = HubSnapshot(
        profile = root.getJSONObject("profile").let {
            Profile(
                displayName = it.getString("display_name"),
                username = "Development profile",
                fingerprint = "Not enrolled",
                pqEnabled = false,
            )
        },
        contacts = root.getJSONArray("contacts").mapObjects { item ->
            val name = item.getString("display_name")
            Contact(
                id = item.getString("id"),
                displayName = name,
                initials = name.split(" ").take(2).joinToString("") { it.take(1) }.uppercase(),
                colorHue = Math.floorMod(name.hashCode(), 360),
                online = item.getBoolean("online"),
                fingerprint = "Not verified",
                statusBody = item.stringOrNull("status_body"),
            )
        },
        conversations = root.getJSONArray("conversations").mapObjects { item ->
            Conversation(
                id = item.getString("id"),
                isGroup = item.getString("conversation_type") != "DIRECT",
                title = item.getString("display_title"),
                participantIds = item.getJSONArray("participant_ids").stringList(),
                unreadCount = item.getInt("unread_count"),
                pinned = item.getBoolean("pinned"),
                muted = item.getBoolean("muted"),
                lastMessagePreview = item.stringOrNull("last_message_preview") ?: "No messages yet",
                lastMessageAt = item.instantMillis("last_message_at"),
            )
        },
        statuses = root.getJSONArray("statuses").mapObjects { item ->
            StatusUpdate(item.getString("id"), item.getString("body"), item.instantMillis("created_at"))
        },
        calls = root.getJSONArray("calls").mapObjects { item ->
            CallRecord(
                id = item.getString("id"),
                peerName = item.stringOrNull("peer_name") ?: "Unknown",
                direction = item.getString("direction"),
                callType = item.getString("call_type"),
                status = item.getString("status"),
                createdAt = item.instantMillis("created_at"),
            )
        },
        communities = root.getJSONArray("communities").mapObjects { item ->
            CommunityRecord(
                item.getString("id"),
                item.getString("name"),
                item.getString("role"),
                item.getString("visibility"),
            )
        },
        media = root.getJSONArray("media").mapObjects { item ->
            MediaRecord(
                id = item.getString("id"),
                mediaType = item.getString("media_type"),
                conversationTitle = item.stringOrNull("conversation_title") ?: "Conversation",
                starred = item.getBoolean("starred"),
                createdAt = item.instantMillis("created_at"),
            )
        },
        devices = root.getJSONArray("devices").mapObjects { item ->
            LinkedDevice(
                id = item.getString("id"),
                name = item.getString("device_name"),
                platform = DevicePlatform.valueOf(item.getString("platform")),
                linkedAt = item.instantMillis("registered_at"),
                lastActive = item.instantMillis("last_seen_at"),
                isCurrent = item.getBoolean("is_current"),
            )
        },
    )

    private fun JSONObject.stringOrNull(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

    private fun JSONObject.instantMillis(key: String): Long =
        stringOrNull(key)?.let { Instant.parse(it).toEpochMilli() } ?: 0L

    private fun JSONArray.stringList(): List<String> =
        (0 until length()).map { getString(it) }

    private fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> =
        (0 until length()).map { transform(getJSONObject(it)) }
}
