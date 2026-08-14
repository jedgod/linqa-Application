package com.linqa.app.network

import android.util.Base64
import com.linqa.app.account.InstallationIdentity
import com.linqa.app.auth.SessionStore
import com.linqa.app.auth.StoredSession
import org.json.JSONObject

data class LinkedAccount(
    val userId: String,
    val accountSlot: Int,
    val label: String?,
    val displayName: String?,
    val phoneSuffix: String?,
    val countryIso2: String?,
)

data class PhoneVerifyChallenge(val phoneIdentityId: String, val state: String, val challengeId: String?)

/**
 * Wraps the real, already-live multi-account vertical
 * (`server/src/routes/multi-account.routes.ts`, the v5 install/account
 * routes) — phone verification here is a separate track from login OTP
 * (`account_identifiers`); it's what gates adding an account to an
 * installation (`phone_identities_v2.verification_state = 'VERIFIED_MOBILE'`).
 */
class MultiAccountApi(
    private val api: RealApiClient,
    private val sessions: SessionStore,
    private val installation: InstallationIdentity,
) {
    suspend fun startPhoneVerification(phoneNumber: String, defaultCountry: String? = null): PhoneVerifyChallenge {
        val body = JSONObject().put("phoneNumber", phoneNumber)
        if (defaultCountry != null) body.put("defaultCountry", defaultCountry)
        val response = api.post("/v5/phone-verification/start", body)
        return PhoneVerifyChallenge(
            phoneIdentityId = response.getString("phoneIdentityId"),
            state = response.getString("state"),
            challengeId = response.optString("challengeId", null),
        )
    }

    suspend fun completePhoneVerification(phoneIdentityId: String, challengeId: String, code: String) {
        api.post(
            "/v5/phone-verification/complete",
            JSONObject().put("phoneIdentityId", phoneIdentityId).put("challengeId", challengeId).put("code", code),
        )
    }

    suspend fun listAccounts(): List<LinkedAccount> {
        val installationId = installation.ensureRegistered(api)
        val response = api.get("/v5/installations/$installationId/accounts")
        val accounts = response.getJSONArray("accounts")
        return (0 until accounts.length()).map { i ->
            val a = accounts.getJSONObject(i)
            LinkedAccount(
                userId = a.getString("user_id"),
                accountSlot = a.getInt("account_slot"),
                label = a.optString("label", null),
                displayName = a.optString("display_name", null),
                phoneSuffix = a.optString("national_number_suffix", null),
                countryIso2 = a.optString("country_iso2", null),
            )
        }
    }

    suspend fun addCurrentAccount(label: String? = null): LinkedAccount {
        val installationId = installation.ensureRegistered(api)
        val userId = sessions.current()?.userId ?: error("No active session.")
        val body = JSONObject().put("targetUserId", userId)
        if (label != null) body.put("label", label)
        val response = api.post("/v5/installations/$installationId/accounts", body)
        return LinkedAccount(
            userId = response.getString("userId"),
            accountSlot = response.getInt("accountSlot"),
            label = label,
            displayName = null,
            phoneSuffix = null,
            countryIso2 = null,
        )
    }

    /** Switches the active session to [toUserId] and persists it, returning
     * the new session so the caller can refresh UI state. */
    suspend fun switchTo(toUserId: String): StoredSession {
        val installationId = installation.ensureRegistered(api)
        val response = api.post(
            "/v5/installations/$installationId/switch",
            JSONObject().put("toUserId", toUserId),
        )
        val accessToken = response.getString("accessToken")
        val claims = decodeJwtPayload(accessToken)
        // /v5/.../switch (SessionServiceAccountIssuer) returns the JWT's own
        // `exp` claim (seconds since epoch) rather than an
        // accessTokenExpiresIn duration like the login/register session
        // shape does — read it directly off the token.
        val stored = StoredSession(
            accessToken = accessToken,
            refreshToken = response.getString("refreshToken"),
            accessTokenExpiresAtMillis = claims.getLong("exp") * 1000L,
            userId = claims.getString("user_id"),
            subject = claims.getString("sub"),
            deviceId = sessions.current()?.deviceId,
        )
        sessions.save(stored)
        return stored
    }

    private fun decodeJwtPayload(jwt: String): JSONObject {
        val parts = jwt.split(".")
        require(parts.size == 3) { "malformed JWT" }
        val payload = Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        return JSONObject(String(payload, Charsets.UTF_8))
    }
}
