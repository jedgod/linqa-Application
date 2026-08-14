package com.linqa.app.calls

import android.util.Base64
import com.linqa.app.auth.SessionStore
import java.util.concurrent.atomic.AtomicLong
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

data class SignalingEvent(
    val senderDeviceId: String,
    val sequence: Long,
    val eventType: String,
    val ciphertextBase64: String,
)

/**
 * Real call-signaling WebSocket client for `GET /v1/calls/signaling?callId=`.
 * Authenticates with a real `Authorization: Bearer` **header** — the web
 * reference client (`clients/web/src/calls/AuthenticatedSignalingClient.ts`)
 * puts the token in an `access_token` query param the server never actually
 * checks (`server/src/auth/jwt.ts`'s `bearerToken()` only reads the header);
 * deliberately not replicating that bug. Tracks a per-call monotonic send
 * sequence and a strictly-increasing replay guard on receipt, matching the
 * web reference client's logic (1:1 calls only, so a single counter per
 * direction is sufficient — see plan's explicit out-of-scope note on group
 * calls).
 */
class SignalingClient(
    private val baseUrl: String,
    private val sessions: SessionStore,
) {
    private val client = OkHttpClient()
    private var socket: WebSocket? = null
    private val nextSequence = AtomicLong(1)
    private var lastReceivedSequence = 0L

    fun connect(
        callId: String,
        onReady: () -> Unit,
        onEvent: (SignalingEvent) -> Unit,
        onClosed: (code: Int, reason: String) -> Unit,
    ) {
        val token = sessions.current()?.accessToken ?: error("not authenticated")
        val wsUrl = "${baseUrl.replaceFirst("http", "ws")}/v1/calls/signaling?callId=$callId"
        val request = Request.Builder().url(wsUrl).header("authorization", "Bearer $token").build()

        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text == "pong") return
                val json = runCatching { JSONObject(text) }.getOrNull() ?: return
                when (json.optString("type")) {
                    "ready" -> onReady()
                    "signaling.event" -> {
                        val sequence = json.optLong("sequence", -1)
                        if (sequence <= lastReceivedSequence) return
                        lastReceivedSequence = sequence
                        onEvent(
                            SignalingEvent(
                                senderDeviceId = json.getString("senderDeviceId"),
                                sequence = sequence,
                                eventType = json.getString("eventType"),
                                ciphertextBase64 = json.getString("ciphertextBase64"),
                            )
                        )
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onClosed(code, reason)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onClosed(-1, t.message ?: "signaling connection failed")
            }
        })
    }

    /** Reserves the next outgoing sequence number. Callers must derive the
     * encryption key from this exact value (it's bound into the signaling
     * crypto's HKDF info) before calling [send] with it. */
    fun reserveSequence(): Long = nextSequence.getAndIncrement()

    fun send(callId: String, recipientDeviceId: String, eventType: String, sequence: Long, ciphertext: ByteArray) {
        val socket = this.socket ?: error("signaling socket is not connected")
        val message = JSONObject()
            .put("callId", callId)
            .put("recipientDeviceId", recipientDeviceId)
            .put("sequence", sequence)
            .put("eventType", eventType)
            .put("ciphertextBase64", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
        socket.send(message.toString())
    }

    fun close() {
        socket?.close(1000, "call ended")
        socket = null
    }
}
