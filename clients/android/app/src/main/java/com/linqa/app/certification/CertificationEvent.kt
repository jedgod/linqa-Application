package com.linqa.app.certification

import java.time.Instant
import org.json.JSONObject

/**
 * One line of two-device certification evidence
 * (`certification/TWO_DEVICE_EXECUTION_MATRIX.md` at the repo root). Evidence
 * fields are restricted by design to IDs, digests, timestamps, and result
 * codes — see [CertificationDigest] — never plaintext, keys, or tokens.
 */
data class CertificationEvent(
    val runId: String,
    val gitSha: String,
    val deviceRole: String,
    val deviceId: String,
    val userId: String,
    val event: String,
    val status: String,
    val evidence: Map<String, Any?> = emptyMap(),
) {
    fun toJson(): String {
        val evidenceJson = JSONObject()
        evidence.forEach { (k, v) -> evidenceJson.put(k, v) }

        return JSONObject()
            .put("schemaVersion", 1)
            .put("runId", runId)
            .put("gitSha", gitSha)
            .put("deviceRole", deviceRole)
            .put("deviceId", deviceId)
            .put("userId", userId)
            .put("event", event)
            .put("status", status)
            .put("timestamp", Instant.now().toString())
            .put("evidence", evidenceJson)
            .toString()
    }
}
