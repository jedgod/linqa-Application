package com.linqa.app.crypto

import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import uniffi.linqa_core.NativeSecureCore
import uniffi.linqa_core.NativeSecureCoreInterface

/**
 * UJB-02: reflects on the *actual* generated UniFFI/JNA binding
 * (`uniffi.linqa_core.NativeSecureCore`, generated from
 * `core/src/uniffi_api.rs` — see `linqa_core.kt`) and asserts its exported
 * method surface is exactly the allowlisted set, with no ad-hoc addition
 * that could leak private key material (e.g. a future
 * `exportPrivateKey`/`rawSigningKey` method added without updating this
 * gate). Purely reflective: never calls `UniffiLib.INSTANCE`, so it needs
 * neither the native `liblinqa_core.so` nor a device/emulator — it runs as
 * a plain JVM unit test (`./gradlew testDebugUnitTest`).
 *
 * Adapted from the pack's assumed `com.linqa.core.NativeCoreFacade`/
 * `identityReady`/`identityPublicKeys` surface to the real class name and
 * real method names in this checkout.
 */
class NativeBindingSurfaceTest {

    private val allowedMethods = setOf(
        "decryptMessage",
        "encryptMessage",
        "exportKeyMaterial",
        "generateKeyPackage",
        "protectionLevel",
        "verifyKeyPackage",
        "verifyTransparencyProof",
        "version",
    )

    /** Substrings that must never appear in an exported method name — each
     * one would indicate a raw private-key accessor slipped into the public
     * FFI surface. */
    private val forbiddenNameFragments = listOf(
        "privatekey", "rawkey", "rawsigning", "rawencryption", "secretbytes",
        "exportprivate", "signingkey", "getprivate",
    )

    /**
     * Kotlin mangles the JVM name of any function taking an unsigned inline
     * value-class parameter (here, `generateKeyPackage(expiresAt: ULong)`)
     * by appending a `-<hash>` suffix, to avoid clashing with a
     * hypothetical signed overload — see KEEP-166. Strip it before
     * comparing against the allowlist, which is keyed on the stable Kotlin
     * source-level name.
     */
    private fun String.withoutMangling(): String = substringBefore('-')

    @Test
    fun `NativeSecureCoreInterface exposes only the allowlisted business methods`() {
        val declared = NativeSecureCoreInterface::class.java.declaredMethods
            .map { it.name.withoutMangling() }
            .toSet()

        val unexpected = declared - allowedMethods
        assertTrue(
            "NativeSecureCoreInterface declares method(s) outside the UJB-02 allowlist: $unexpected. " +
                "If this is an intentional new capability, extend `allowedMethods` here AND re-run the " +
                "private-key-boundary Rust tests (core/tests/uniffi_private_key_boundary.rs) against it.",
            unexpected.isEmpty(),
        )

        val missing = allowedMethods - declared
        assertTrue(
            "NativeSecureCoreInterface no longer declares expected method(s): $missing " +
                "(binding surface drifted from core/src/uniffi_api.rs; regenerate bindings or update this test)",
            missing.isEmpty(),
        )
    }

    @Test
    fun `no method on the generated binding class exposes raw private key material by name`() {
        val allMethodNames = NativeSecureCore::class.java.methods.map { it.name.withoutMangling().lowercase() } +
            NativeSecureCoreInterface::class.java.declaredMethods.map { it.name.withoutMangling().lowercase() }

        for (name in allMethodNames) {
            for (fragment in forbiddenNameFragments) {
                if (name.contains(fragment)) {
                    fail("Method `$name` on the UniFFI binding surface matches forbidden pattern `$fragment`")
                }
            }
        }
    }

    @Test
    fun `DeviceIdentity exposes no general-purpose raw private key accessor`() {
        val methodNames = DeviceIdentity::class.java.declaredMethods.map { it.name }

        // The one intentional, narrow boundary — see DeviceIdentity.kt's own
        // doc comment on this method for why it exists and why it's safe.
        assertTrue(
            "DeviceIdentity must keep its sole narrow key-sealing export boundary",
            methodNames.contains("sealNativeKeyMaterial"),
        )

        val forbidden = setOf(
            "getSigningPrivateKey", "getEncryptionPrivateKey", "exportPrivateKey",
            "rawSigningKey", "rawEncryptionKey", "getPrivateKey", "privateKeyBytes",
        )
        val leaked = methodNames.filter { it in forbidden }
        assertTrue("DeviceIdentity exposes forbidden raw-key accessor(s): $leaked", leaked.isEmpty())
    }
}
