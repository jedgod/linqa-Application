package com.linqa.app.certification

/**
 * Records real outcomes from the live send/receive/key-rotation paths
 * (`messages/E2eeMessageRepository.kt`, `network/KeyPackageApi.kt`) as
 * certification evidence. These calls do not make a certification run pass —
 * they only capture what actually happened, for
 * `certification/16_validate_two_device.py` to later evaluate against a real
 * Alice+Bob two-device run. Nothing here fabricates PASS/FAIL; every status
 * is derived from the real result the caller observed.
 */
class TwoDeviceCertificationHooks(
    private val recorder: CertificationRecorder,
    private val runId: String,
    private val gitSha: String,
    private val role: String,
    private val userId: String,
    private val deviceId: String,
) {
    fun sendAccepted(envelopeId: String, clientMessageId: String, recipientDeviceId: String, plaintext: String) =
        record(
            "SEND_ACCEPTED",
            mapOf(
                "envelopeId" to envelopeId,
                "clientMessageId" to clientMessageId,
                "recipientDeviceId" to recipientDeviceId,
                "plaintextSha256" to CertificationDigest.sha256Utf8(plaintext),
            ),
        )

    fun receiveDecrypted(envelopeId: String, clientMessageId: String, senderDeviceId: String, plaintext: String) =
        record(
            "RECEIVE_DECRYPTED",
            mapOf(
                "envelopeId" to envelopeId,
                "clientMessageId" to clientMessageId,
                "senderDeviceId" to senderDeviceId,
                "plaintextSha256" to CertificationDigest.sha256Utf8(plaintext),
            ),
        )

    fun offlineEnter() = record("OFFLINE_ENTER")
    fun offlineExit() = record("OFFLINE_EXIT")

    fun duplicateRetry(originalEnvelopeId: String, retryEnvelopeId: String, noDuplicateLocalMessage: Boolean) =
        record(
            "DUPLICATE_RETRY",
            mapOf(
                "originalEnvelopeId" to originalEnvelopeId,
                "retryEnvelopeId" to retryEnvelopeId,
                "noDuplicateLocalMessage" to noDuplicateLocalMessage,
            ),
            if (noDuplicateLocalMessage) "PASS" else "FAIL",
        )

    fun tamperRejected(code: String) =
        record(
            "TAMPER_REJECTED",
            mapOf("failureCode" to code),
            if (code in setOf("authentication_failed", "invalid_mac", "aead_open_failed", "aad_binding_mismatch")) {
                "PASS"
            } else {
                "FAIL"
            },
        )

    fun keyRotated(oldPackageId: String, newPackageId: String, oldPackageRejected: Boolean) =
        record(
            "KEY_ROTATED",
            mapOf(
                "oldPackageId" to oldPackageId,
                "newPackageId" to newPackageId,
                "oldPackageRejected" to oldPackageRejected,
            ),
            if (oldPackageRejected && oldPackageId != newPackageId) "PASS" else "FAIL",
        )

    fun revokedDeviceBlocked(revokedDeviceId: String, postRevokeEnvelopeCount: Int) =
        record(
            "REVOKED_DEVICE_BLOCKED",
            mapOf(
                "revokedDeviceId" to revokedDeviceId,
                "postRevokeEnvelopeCount" to postRevokeEnvelopeCount,
            ),
            if (postRevokeEnvelopeCount == 0) "PASS" else "FAIL",
        )

    private fun record(event: String, evidence: Map<String, Any?> = emptyMap(), status: String = "PASS") {
        recorder.record(
            CertificationEvent(
                runId = runId,
                gitSha = gitSha,
                deviceRole = role,
                deviceId = deviceId,
                userId = userId,
                event = event,
                status = status,
                evidence = evidence,
            ),
        )
    }
}
