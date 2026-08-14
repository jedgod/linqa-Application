package com.linqa.app.certification

import java.security.MessageDigest

/** Used to prove two devices agree on a message's content without ever
 * writing the plaintext itself into certification evidence. */
object CertificationDigest {
    fun sha256Utf8(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
}
