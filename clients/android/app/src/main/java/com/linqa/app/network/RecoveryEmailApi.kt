package com.linqa.app.network

import org.json.JSONObject

data class RecoveryEmailChallenge(val challengeId: String, val expiresAt: String)

/**
 * Links a recovery email to the current account. A recovery email is just a
 * second, non-primary, verified EMAIL row in the server's generic
 * `account_identifiers` table — reuses the same OTP challenge mechanism as
 * login (`POST /v1/account/recovery-email[/verify]`), not a separate system.
 */
class RecoveryEmailApi(private val api: RealApiClient) {
    suspend fun start(email: String): RecoveryEmailChallenge {
        val response = api.post("/v1/account/recovery-email", JSONObject().put("email", email))
        return RecoveryEmailChallenge(
            challengeId = response.getString("challengeId"),
            expiresAt = response.getString("expiresAt"),
        )
    }

    suspend fun verify(challengeId: String, code: String): String {
        val response = api.post(
            "/v1/account/recovery-email/verify",
            JSONObject().put("challengeId", challengeId).put("code", code),
        )
        return response.getString("email")
    }
}
