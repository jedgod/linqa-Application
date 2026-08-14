package com.linqa.app.network

import android.util.Base64
import com.linqa.app.auth.SessionStore
import com.linqa.app.auth.StoredSession
import com.linqa.app.crypto.DeviceIdentity
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.time.Instant
import org.json.JSONObject

private val DOMAIN = "linqa:device-enrollment:v1".toByteArray(Charsets.UTF_8)

/**
 * Real device enrollment: `POST /v1/device-enrollment/challenges` then
 * `POST /v1/device-enrollment/complete`, signing the exact same canonical
 * digest `server/src/auth/enrollment-proof.ts::canonicalEnrollmentDigest`
 * verifies server-side (byte-for-byte: domain, challengeId, userId, raw
 * nonce, big-endian i64 expiry, deviceName, platform, both raw 32-byte
 * public keys, SHA-256). On success, swaps the pre-enrollment session for
 * the real device-bound, `calls:write`-scoped one server/src/routes/
 * enrollment.ts now issues.
 */
class EnrollmentApi(
    private val api: RealApiClient,
    private val sessions: SessionStore,
    private val identity: DeviceIdentity,
) {
    suspend fun enroll(deviceName: String, platform: String = "ANDROID"): StoredSession {
        val current = sessions.current() ?: error("must be logged in before enrolling a device")
        val keys = identity.ensureKeys()

        val challenge = api.post("/v1/device-enrollment/challenges")
        val challengeId = challenge.getString("challengeId")
        val userId = challenge.getString("userId")
        val nonce = Base64.decode(challenge.getString("nonceBase64"), Base64.NO_WRAP)
        val expiresAtUnix = Instant.parse(challenge.getString("expiresAt")).epochSecond

        val digest = canonicalDigest(
            challengeId = challengeId,
            userId = userId,
            nonce = nonce,
            expiresAtUnix = expiresAtUnix,
            deviceName = deviceName,
            platform = platform,
            signingPublicKey = keys.signingPublicKey,
            encryptionPublicKey = keys.encryptionPublicKey,
        )
        val signature = identity.sign(digest)

        val completeBody = JSONObject()
            .put("challengeId", challengeId)
            .put("deviceName", deviceName)
            .put("platform", platform)
            .put(
                "signingPublicKeyBase64",
                Base64.encodeToString(keys.signingPublicKey, Base64.NO_WRAP),
            )
            .put(
                "encryptionPublicKeyBase64",
                Base64.encodeToString(keys.encryptionPublicKey, Base64.NO_WRAP),
            )
            .put("signatureBase64", Base64.encodeToString(signature, Base64.NO_WRAP))

        val response = api.post("/v1/device-enrollment/complete", completeBody)
        val deviceId = response.getString("deviceId")
        val newSession = response.getJSONObject("session")

        val stored = StoredSession(
            accessToken = newSession.getString("accessToken"),
            refreshToken = newSession.getString("refreshToken"),
            accessTokenExpiresAtMillis =
                System.currentTimeMillis() + newSession.getInt("accessTokenExpiresIn") * 1000L,
            userId = current.userId,
            subject = current.subject,
            deviceId = deviceId,
        )
        sessions.save(stored)
        return stored
    }

    private fun canonicalDigest(
        challengeId: String,
        userId: String,
        nonce: ByteArray,
        expiresAtUnix: Long,
        deviceName: String,
        platform: String,
        signingPublicKey: ByteArray,
        encryptionPublicKey: ByteArray,
    ): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(DOMAIN)
        digest.update(challengeId.toByteArray(Charsets.UTF_8))
        digest.update(userId.toByteArray(Charsets.UTF_8))
        digest.update(nonce)
        digest.update(
            ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN).putLong(expiresAtUnix).array(),
        )
        digest.update(deviceName.toByteArray(Charsets.UTF_8))
        digest.update(platform.toByteArray(Charsets.UTF_8))
        digest.update(signingPublicKey)
        digest.update(encryptionPublicKey)
        return digest.digest()
    }
}
