package com.linqa.app.crypto

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import org.json.JSONObject

private val DOMAIN = "linqa:signaling:v1".toByteArray(Charsets.UTF_8)
private const val NONCE_BYTES = 12
private const val KEY_BYTES = 32
private const val GCM_TAG_BITS = 128

/**
 * Real E2E encryption for call-signaling payloads (SDP offers/answers, ICE
 * candidates) sent over `calls/SignalingClient.kt`'s WebSocket — the
 * server only ever sees the resulting ciphertext. X25519 ECDH (via
 * [DeviceIdentity.agree]) + HKDF-SHA256 + AES-256-GCM, the same shape as
 * this session's Rust `core::crypto::hybrid_kem` / `core::envelope` work,
 * implemented natively here since no UniFFI bridge exists for Android yet.
 *
 * The HKDF `info` binds to `callId`, `senderDeviceId`, and `sequence` —
 * always the message's actual sender, not "whoever is calling encrypt right
 * now" — so both sides derive the identical key regardless of direction:
 * the sender uses their own device id, the receiver uses the sender id
 * carried on the received `signaling.event` push.
 */
class SignalingCrypto(private val identity: DeviceIdentity) {

    fun encrypt(
        callId: String,
        senderDeviceId: String,
        sequence: Long,
        recipientPublicKey: ByteArray,
        payload: JSONObject,
    ): ByteArray {
        val key = deriveKey(callId, senderDeviceId, sequence, recipientPublicKey)
        val nonce = ByteArray(NONCE_BYTES).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, nonce))
        val ciphertext = cipher.doFinal(payload.toString().toByteArray(Charsets.UTF_8))
        return nonce + ciphertext
    }

    fun decrypt(
        callId: String,
        senderDeviceId: String,
        sequence: Long,
        senderPublicKey: ByteArray,
        sealed: ByteArray,
    ): JSONObject {
        require(sealed.size > NONCE_BYTES) { "sealed signaling payload too short" }
        val nonce = sealed.copyOfRange(0, NONCE_BYTES)
        val ciphertext = sealed.copyOfRange(NONCE_BYTES, sealed.size)
        val key = deriveKey(callId, senderDeviceId, sequence, senderPublicKey)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, nonce))
        val plaintext = cipher.doFinal(ciphertext)
        return JSONObject(String(plaintext, Charsets.UTF_8))
    }

    private fun deriveKey(
        callId: String,
        senderDeviceId: String,
        sequence: Long,
        theirPublicKey: ByteArray,
    ): ByteArray {
        val shared = identity.agree(theirPublicKey)
        val info = "$callId:$senderDeviceId:$sequence".toByteArray(Charsets.UTF_8)
        val hkdf = HKDFBytesGenerator(SHA256Digest())
        hkdf.init(HKDFParameters(shared, DOMAIN, info))
        val key = ByteArray(KEY_BYTES)
        hkdf.generateBytes(key, 0, KEY_BYTES)
        return key
    }
}
