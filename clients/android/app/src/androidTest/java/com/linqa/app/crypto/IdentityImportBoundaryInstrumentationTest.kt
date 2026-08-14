package com.linqa.app.crypto

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.linqa_core.NativeSecureCore

/**
 * UJB-05: on-device instrumentation test for the real key-import boundary —
 * [DeviceIdentity.sealNativeKeyMaterial] handing a zeroizable
 * [SecretBytes]-wrapped blob to [NativeCore] so it can bind a freshly
 * generated UniFFI core identity to this device's already-enrolled
 * Ed25519/X25519 keys. Requires the actual `liblinqa_core.so` (loaded via
 * JNA), so — unlike [NativeBindingSurfaceTest] — this only runs on a real
 * device or emulator (`./gradlew connectedAndroidTest`), not the JVM unit
 * test runner. Uses only the app's real, existing public API (no
 * test-only constructors added to production classes).
 *
 * Adapted from the pack's assumed `com.linqa.core.NativeCoreFacade` /
 * `identityReady()` surface to the real `NativeCore` object and
 * `DeviceIdentity` class in this checkout.
 */
@RunWith(AndroidJUnit4::class)
class IdentityImportBoundaryInstrumentationTest {

    @Test
    fun bindToDeviceIdentity_producesACoreWhoseSigningKeyMatchesTheEnrolledDeviceKey() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val deviceIdentity = DeviceIdentity(context)
        val deviceKeys = deviceIdentity.ensureKeys() // idempotent: reuses existing keys if already enrolled

        NativeCore.initialize(context, deviceIdentity)
        assumeTrue(
            "liblinqa_core.so not loadable on this device/ABI; skipping (unrelated to the key-import boundary itself)",
            NativeCore.isLoaded(),
        )
        val core = NativeCore.instance()
        assertNotNull(core)

        // The bound core's key package must carry the SAME Ed25519 signing
        // public key DeviceIdentity already enrolled with the server — this
        // is the entire point of the binding boundary: a key package signed
        // by a core the server never saw at enrollment would fail every
        // recipient's `parseAndVerifyKeyPackage` (server/src/auth/
        // key-package-proof.ts).
        val packageB64 = core!!.generateKeyPackage(
            "it-user",
            "it-device",
            (System.currentTimeMillis() / 1000 + 3600).toULong(),
        )
        val packageBytes = android.util.Base64.decode(packageB64, android.util.Base64.DEFAULT)
        val packageJson = org.json.JSONObject(String(packageBytes, Charsets.UTF_8))
        val signingArray = packageJson.getJSONArray("signing_public_key")
        val signingPublicFromPackage = ByteArray(signingArray.length()) { i -> signingArray.getInt(i).toByte() }

        assertTrue(
            "core identity's signing public key does not match DeviceIdentity's enrolled key",
            signingPublicFromPackage.contentEquals(deviceKeys.signingPublicKey),
        )
    }

    @Test
    fun sealNativeKeyMaterial_returnsASecretThatIsUsableExactlyOnce() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val deviceIdentity = DeviceIdentity(context)
        deviceIdentity.ensureKeys()

        val pqSecret = NativeSecureCore().let { fresh ->
            val materialB64 = fresh.exportKeyMaterial()
            val materialBytes = android.util.Base64.decode(materialB64, android.util.Base64.DEFAULT)
            val json = org.json.JSONObject(String(materialBytes, Charsets.UTF_8))
            val arr = json.getJSONArray("pq_encryption_secret")
            ByteArray(arr.length()) { i -> arr.getInt(i).toByte() }
        }

        val sealed = deviceIdentity.sealNativeKeyMaterial(pqSecret)

        var sawBytes = false
        sealed.use { secret ->
            secret.useBytes { bytes ->
                sawBytes = bytes.isNotEmpty()
            }
        }
        assertTrue("sealed key material was empty", sawBytes)

        // SecretBytes is single-use/closeable: using it again after close()
        // must fail closed rather than silently handing out a second copy
        // of private key material.
        var reuseThrew = false
        try {
            sealed.useBytes { }
        } catch (_: Exception) {
            reuseThrew = true
        }
        assertTrue(
            "SecretBytes allowed reuse after close() — private key material boundary is not single-use",
            reuseThrew,
        )
    }
}
