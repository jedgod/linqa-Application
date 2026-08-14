package com.linqa.app.network

import org.json.JSONArray
import org.json.JSONObject

data class SubmittedEnvelope(
    val envelopeId: String,
    val serverSequence: Long,
    val acceptedAt: String,
    val idempotentReplay: Boolean,
)

data class LeasedEnvelope(
    val id: String,
    val senderDeviceId: String,
    val senderSigningPublicKeyBase64: String,
    val clientMessageId: String,
    val ciphertextBase64: String,
    val serverSequence: Long,
    val acceptedAt: String,
    val expiresAt: String,
)

data class LeasedEnvelopeBatch(
    val leaseOwner: String,
    val leaseExpiresInSeconds: Int,
    val envelopes: List<LeasedEnvelope>,
)

/**
 * Ciphertext-only relay transport (`server/src/routes/relay.ts`). The server
 * never sees plaintext: `ciphertextBase64` here is always the base64 output
 * of [com.linqa.app.crypto.NativeCore]'s `encryptMessage`/`decryptMessage`
 * (a serialized `core::envelope::MessageEnvelope`), opaque to everything
 * between the two devices' cores.
 */
class EnvelopeApi(private val api: RealApiClient) {
    suspend fun submit(
        recipientDeviceId: String,
        clientMessageId: String,
        ciphertextBase64: String,
        expiresAt: String? = null,
    ): SubmittedEnvelope {
        val body = JSONObject()
            .put("recipientDeviceId", recipientDeviceId)
            .put("clientMessageId", clientMessageId)
            .put("ciphertextBase64", ciphertextBase64)
        if (expiresAt != null) body.put("expiresAt", expiresAt)

        val response = api.post("/v1/relay/envelopes", body)
        return SubmittedEnvelope(
            envelopeId = response.getString("envelopeId"),
            serverSequence = response.getLong("serverSequence"),
            acceptedAt = response.getString("acceptedAt"),
            idempotentReplay = response.optBoolean("idempotentReplay", false),
        )
    }

    suspend fun fetchPending(limit: Int = 100): LeasedEnvelopeBatch {
        val response = api.get("/v1/relay/envelopes?limit=$limit")
        val rows = response.getJSONArray("envelopes")
        val envelopes = (0 until rows.length()).map { i ->
            val row = rows.getJSONObject(i)
            LeasedEnvelope(
                id = row.getString("id"),
                senderDeviceId = row.getString("senderDeviceId"),
                senderSigningPublicKeyBase64 = row.getString("senderSigningPublicKeyBase64"),
                clientMessageId = row.getString("clientMessageId"),
                ciphertextBase64 = row.getString("ciphertextBase64"),
                serverSequence = row.getLong("serverSequence"),
                acceptedAt = row.getString("acceptedAt"),
                expiresAt = row.getString("expiresAt"),
            )
        }
        return LeasedEnvelopeBatch(
            leaseOwner = response.getString("leaseOwner"),
            leaseExpiresInSeconds = response.getInt("leaseExpiresInSeconds"),
            envelopes = envelopes,
        )
    }

    suspend fun acknowledge(leaseOwner: String, envelopeIds: List<String>) {
        if (envelopeIds.isEmpty()) return
        api.post(
            "/v1/relay/acknowledgements",
            JSONObject()
                .put("leaseOwner", leaseOwner)
                .put("envelopeIds", JSONArray(envelopeIds)),
        )
    }
}
