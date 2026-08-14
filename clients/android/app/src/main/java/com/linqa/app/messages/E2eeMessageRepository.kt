package com.linqa.app.messages

import android.util.Base64
import android.util.Log
import com.linqa.app.auth.SessionStore
import com.linqa.app.certification.TwoDeviceCertificationHooks
import com.linqa.app.crypto.NativeCore
import com.linqa.app.network.EnvelopeApi
import com.linqa.app.network.KeyPackageApi
import com.linqa.app.network.SubmittedEnvelope
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import uniffi.linqa_core.NativeCoreException

data class DecryptedMessage(
    val envelopeId: String,
    val senderDeviceId: String,
    val clientMessageId: String,
    val text: String,
    val acceptedAt: String,
)

/**
 * Real 1:1 ciphertext-only message transport: [NativeCore] (X25519 + ML-KEM
 * hybrid agreement, XChaCha20-Poly1305, Ed25519 signing — `core/src/
 * envelope.rs`) encrypts/decrypts; [KeyPackageApi] resolves the recipient's
 * signed public keys; [EnvelopeApi] carries only opaque ciphertext through
 * `server/src/routes/relay.ts`, which explicitly rejects any request body
 * containing a `plaintext`/`body`/`text` field. Plaintext exists only inside
 * this process, never crosses the network or touches the server.
 */
class E2eeMessageRepository(
    private val sessions: SessionStore,
    private val keyPackageApi: KeyPackageApi,
    private val envelopeApi: EnvelopeApi,
    /** Null in ordinary use. Only set by a real two-device certification run
     * (see `certification/TWO_DEVICE_EXECUTION_MATRIX.md`) — its presence
     * never changes send/receive behavior, only whether the real outcome
     * below also gets recorded as evidence. */
    private val certificationHooks: TwoDeviceCertificationHooks? = null,
) {
    suspend fun sendText(recipientUserId: String, plaintext: String): SubmittedEnvelope {
        require(plaintext.isNotBlank()) { "empty_message" }
        val secureCore = NativeCore.instance() ?: error("native secure core not loaded")
        val session = sessions.current() ?: error("not authenticated")
        val senderDeviceId = session.deviceId ?: error("device not enrolled")

        val recipient = keyPackageApi.resolveDevice(recipientUserId)
            ?: error("recipient has no reachable device")

        val now = Instant.now()
        val expiresAt = now.plus(30, ChronoUnit.DAYS)
        val clientMessageId = UUID.randomUUID().toString()

        val encryptRequest = JSONObject().apply {
            put("recipient_encryption_public_key", recipient.encryptionPublicKey.toJsonArray())
            put("recipient_pq_encryption_public_key", recipient.pqEncryptionPublicKey.toJsonArray())
            put("sender_user_id", session.userId)
            put("sender_device_id", senderDeviceId)
            put("recipient_user_id", recipientUserId)
            put("recipient_device_id", recipient.deviceId)
            put("message_id", clientMessageId)
            put("plaintext", plaintext.toByteArray(StandardCharsets.UTF_8).toJsonArray())
            put("created_at_unix", now.epochSecond)
            put("expires_at_unix", expiresAt.epochSecond)
        }
        val ciphertextBase64 = secureCore.encryptMessage(encryptRequest.toString())

        val submitted = envelopeApi.submit(
            recipientDeviceId = recipient.deviceId,
            clientMessageId = clientMessageId,
            ciphertextBase64 = ciphertextBase64,
            expiresAt = expiresAt.toString(),
        )
        certificationHooks?.sendAccepted(submitted.envelopeId, clientMessageId, recipient.deviceId, plaintext)
        return submitted
    }

    /** Fetches this device's pending envelope lease, decrypts everything it
     * can, and acknowledges only what actually decrypted — anything that
     * fails authentication is left unacknowledged for later retry/review
     * rather than silently dropped. */
    suspend fun receivePending(): List<DecryptedMessage> {
        val secureCore = NativeCore.instance() ?: error("native secure core not loaded")
        val session = sessions.current() ?: error("not authenticated")
        val recipientDeviceId = session.deviceId ?: error("device not enrolled")

        val batch = envelopeApi.fetchPending()
        if (batch.envelopes.isEmpty()) return emptyList()

        val decrypted = mutableListOf<DecryptedMessage>()
        val acknowledged = mutableListOf<String>()

        for (envelope in batch.envelopes) {
            try {
                val envelopeJson = JSONObject(
                    String(Base64.decode(envelope.ciphertextBase64, Base64.NO_WRAP), StandardCharsets.UTF_8),
                )
                val decryptRequest = JSONObject().apply {
                    put("expected_recipient_device_id", recipientDeviceId)
                    put(
                        "sender_signing_public_key",
                        Base64.decode(envelope.senderSigningPublicKeyBase64, Base64.NO_WRAP).toJsonArray(),
                    )
                    put("envelope", envelopeJson)
                    put("now_unix", Instant.now().epochSecond)
                }
                val decryptRequestB64 = Base64.encodeToString(
                    decryptRequest.toString().toByteArray(StandardCharsets.UTF_8),
                    Base64.NO_WRAP,
                )
                val plaintextBytes = Base64.decode(secureCore.decryptMessage(decryptRequestB64), Base64.NO_WRAP)

                val text = String(plaintextBytes, StandardCharsets.UTF_8)
                decrypted.add(
                    DecryptedMessage(
                        envelopeId = envelope.id,
                        senderDeviceId = envelope.senderDeviceId,
                        clientMessageId = envelope.clientMessageId,
                        text = text,
                        acceptedAt = envelope.acceptedAt,
                    ),
                )
                acknowledged.add(envelope.id)
                certificationHooks?.receiveDecrypted(envelope.id, envelope.clientMessageId, envelope.senderDeviceId, text)
            } catch (error: Exception) {
                Log.w(TAG, "envelope ${envelope.id} failed to decrypt; left unacknowledged", error)
                val code = if (error is NativeCoreException.AuthenticationFailed) {
                    "authentication_failed"
                } else {
                    "decrypt_failed"
                }
                certificationHooks?.tamperRejected(code)
            }
        }

        if (acknowledged.isNotEmpty()) {
            envelopeApi.acknowledge(batch.leaseOwner, acknowledged)
        }

        return decrypted
    }

    private fun ByteArray.toJsonArray(): JSONArray {
        val array = JSONArray()
        for (b in this) array.put(b.toInt() and 0xFF)
        return array
    }

    private companion object {
        const val TAG = "E2eeMessageRepository"
    }
}
