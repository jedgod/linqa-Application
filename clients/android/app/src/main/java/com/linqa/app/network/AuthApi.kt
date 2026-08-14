package com.linqa.app.network

import android.util.Base64
import com.linqa.app.auth.SessionStore
import com.linqa.app.auth.StoredSession
import org.json.JSONObject

data class ChallengeResult(val challengeId: String, val expiresAt: String)

sealed interface VerifyResult {
    data class Authenticated(val session: StoredSession) : VerifyResult
    data object RegistrationRequired : VerifyResult
}

/**
 * Real phone/email OTP login (`POST /v1/auth/challenges` +
 * `POST /v1/auth/challenges/verify`), against the same scrypt-hashed,
 * rate-limited challenge service used by every other real Linqa client —
 * nothing like this existed in the Android app before.
 */
class AuthApi(
    private val api: RealApiClient,
    private val sessions: SessionStore,
) {
    suspend fun requestChallenge(identifier: String, purpose: String = "LOGIN"): ChallengeResult {
        val response = api.postUnauthenticated(
            "/v1/auth/challenges",
            JSONObject().put("identifier", identifier).put("purpose", purpose),
        )
        return ChallengeResult(
            challengeId = response.getString("challengeId"),
            expiresAt = response.getString("expiresAt"),
        )
    }

    suspend fun verifyChallenge(challengeId: String, code: String): VerifyResult {
        val response = api.postUnauthenticated(
            "/v1/auth/challenges/verify",
            JSONObject().put("challengeId", challengeId).put("code", code),
        )

        if (!response.optBoolean("accountExists", false)) {
            return VerifyResult.RegistrationRequired
        }

        return VerifyResult.Authenticated(storeSession(response.getJSONObject("temporarySession")))
    }

    /**
     * Creates a brand-new account from a REGISTRATION-purpose challenge
     * that [verifyChallenge] already reported as [VerifyResult.RegistrationRequired]
     * (its code was proven and consumed by that call — this step does not
     * take the code again). Real account creation via `POST /v1/auth/register`;
     * previously there was no client path for this at all.
     */
    suspend fun register(challengeId: String): StoredSession {
        val response = api.postUnauthenticated(
            "/v1/auth/register",
            JSONObject().put("challengeId", challengeId),
        )
        return storeSession(response.getJSONObject("temporarySession"))
    }

    private fun storeSession(session: JSONObject): StoredSession {
        val accessToken = session.getString("accessToken")
        val claims = decodeJwtPayload(accessToken)

        val stored = StoredSession(
            accessToken = accessToken,
            refreshToken = session.getString("refreshToken"),
            accessTokenExpiresAtMillis =
                System.currentTimeMillis() + session.getInt("accessTokenExpiresIn") * 1000L,
            userId = claims.getString("user_id"),
            subject = claims.getString("sub"),
            deviceId = null,
        )
        sessions.save(stored)
        return stored
    }
}

/** Reads the claims out of a freshly-received, TLS-delivered JWT from our
 * own server. No signature verification is performed or needed here — the
 * client trusts the connection it just received the token over, the same
 * way any client trusts a token it was just handed after login. */
private fun decodeJwtPayload(jwt: String): JSONObject {
    val parts = jwt.split(".")
    require(parts.size == 3) { "malformed JWT" }
    val payload = Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    return JSONObject(String(payload, Charsets.UTF_8))
}
