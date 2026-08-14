package com.linqa.app.crypto

import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Narrow, explicitly-zeroizable secret container. Never convert its contents
 * to a `String`, log them, or return them from a general-purpose API — the
 * only sanctioned use is `useBytes` inside a `.use { }` block immediately
 * before handing the bytes to the one native import call that needs them
 * (see `NativeCore.bindToDeviceIdentity`).
 *
 * This is a best-effort mitigation, not a guarantee: the JVM can still leave
 * copies in GC'd memory, and the final handoff to `NativeSecureCore.fromKeyMaterial`
 * requires a `String` (immutable, unzeroizable) because that's the exposed
 * UniFFI signature. What this class *does* buy: no call site can casually
 * hold, log, or re-serialize the raw key bytes — it disappears with `close()`.
 */
class SecretBytes private constructor(private var value: ByteArray?) : Closeable {
    private val closed = AtomicBoolean(false)

    companion object {
        fun takeOwnership(bytes: ByteArray): SecretBytes = SecretBytes(bytes)
    }

    fun <T> useBytes(block: (ByteArray) -> T): T {
        check(!closed.get()) { "secret_closed" }
        return block(value ?: error("secret_missing"))
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            value?.fill(0)
            value = null
        }
    }
}
