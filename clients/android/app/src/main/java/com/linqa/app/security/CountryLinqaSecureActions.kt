package com.linqa.app.security

import com.linqa.app.network.CountryLinqaApi

class LocalAuthCancelledException : Exception("Local authentication was cancelled.")

/**
 * Orchestrates a CountryLinqa "sensitive action" end-to-end: local device
 * authentication gate, then a server step-up challenge/consume round trip,
 * then the actual action. Ported from the pack's
 * `performCountryLinqaSensitiveAction` with the same signature contract —
 * `authenticateLocally` is a caller-supplied suspend callback (e.g. a
 * BiometricPrompt result) rather than hardcoded here, same as the pack's
 * own note that this should combine with the platform's existing MFA/
 * session step-up flow.
 */
suspend fun performCountryLinqaSensitiveAction(
    api: CountryLinqaApi,
    purpose: String,
    authenticateLocally: suspend () -> Boolean,
    action: suspend () -> Unit,
) {
    if (!authenticateLocally()) {
        throw LocalAuthCancelledException()
    }

    val challenge = api.createStepUpChallenge(purpose)
    api.consumeStepUpChallenge(challenge.challengeId, challenge.challenge, purpose)
    action()
}
