package com.linqa.app.network

import org.json.JSONObject

data class TurnCredentials(
    val urls: List<String>,
    val username: String,
    val credential: String,
    val expiresAt: String,
)

data class CreatedCall(
    val callId: String,
    val mode: String,
    val privacyMode: String,
)

/** Real `/v1/calls*` client — TURN credential minting, call creation, and
 * ending. Backed by the same `call_sessions`/`call_participants` tables and
 * coturn-shared-secret TURN scheme every other real Linqa client uses. */
class CallsApi(private val api: RealApiClient) {

    suspend fun turnCredentials(): TurnCredentials {
        val response = api.get("/v1/calls/turn-credentials")
        val urls = response.getJSONArray("urls")
        return TurnCredentials(
            urls = (0 until urls.length()).map { urls.getString(it) },
            username = response.getString("username"),
            credential = response.getString("credential"),
            expiresAt = response.getString("expiresAt"),
        )
    }

    suspend fun createCall(
        recipientUserId: String,
        recipientDeviceId: String,
        video: Boolean,
        privacyMode: String = "STANDARD",
    ): CreatedCall {
        val response = api.post(
            "/v1/calls",
            JSONObject()
                .put("recipientUserId", recipientUserId)
                .put("recipientDeviceId", recipientDeviceId)
                .put("mode", "LIVE")
                .put("privacyMode", privacyMode),
        )
        return CreatedCall(
            callId = response.getString("callId"),
            mode = response.getString("mode"),
            privacyMode = response.getString("privacyMode"),
        )
    }

    suspend fun endCall(callId: String) {
        api.post("/v1/calls/$callId/end")
    }
}
