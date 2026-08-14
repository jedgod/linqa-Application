package com.linqa.app.certification

import android.content.Context
import java.io.File

/**
 * Appends certification evidence to a local, debug-readable file
 * (`certification/pull_android_evidence.sh` pulls it via
 * `adb shell run-as <app-id> cat files/linqa-certification-events.jsonl`).
 * Not wired into any release build surface — see
 * `certification/14_release_surface_scan.sh`'s intent: no certification
 * control should ever be reachable outside a debug build.
 */
class CertificationRecorder(private val context: Context) {
    private val file: File
        get() = File(context.filesDir, "linqa-certification-events.jsonl")

    @Synchronized
    fun record(event: CertificationEvent) {
        file.appendText(event.toJson() + "\n", Charsets.UTF_8)
    }
}
