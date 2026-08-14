package com.linqa.app.crypto

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject
import uniffi.linqa_core.NativeSecureCore

/**
 * Owns the single [NativeSecureCore] instance for this process. The core's
 * exported key material (Ed25519 + X25519 + ML-KEM secrets, see
 * `core/src/identity.rs`) is generated once and persisted the same way
 * `DeviceIdentity` persists its own keys: Keystore-wrapped
 * EncryptedSharedPreferences, never plaintext.
 *
 * Loading `liblinqa_core.so` is best-effort: if it's missing for the
 * running ABI (e.g. an old build predating this wiring), the app falls
 * back to the pre-existing dev/mobile-hub bridge in [CoreBridge] instead
 * of crashing the whole process over an unrelated feature.
 */
object NativeCore {
    private const val TAG = "NativeCore"
    private const val PREFS_NAME = "linqa-native-core"
    private const val KEY_MATERIAL = "key_material_b64"
    private const val KEY_BOUND_SIGNING_PUBLIC = "bound_signing_public_key_b64"

    @Volatile private var core: NativeSecureCore? = null
    @Volatile private var loadAttempted = false

    /**
     * [deviceIdentity] is required so the core's identity binds to the same
     * Ed25519/X25519 keys already enrolled with the server (see
     * `bindToDeviceIdentity`) — without this, published key packages would be
     * signed by a key the server never saw at enrollment and every recipient
     * verification would fail.
     */
    fun initialize(context: Context, deviceIdentity: DeviceIdentity) {
        if (loadAttempted) return
        loadAttempted = true
        try {
            System.loadLibrary("linqa_core")
            core = loadOrCreateCore(context, deviceIdentity)
            Log.i(TAG, "linqa_core loaded, version=${core?.version()}")
            val selfTestPassed = runSelfTest()
            Log.i(TAG, "linqa_core encrypt/decrypt self-test: ${if (selfTestPassed) "PASSED" else "FAILED"}")
        } catch (error: UnsatisfiedLinkError) {
            Log.w(TAG, "liblinqa_core.so not available for this build/ABI; native crypto core disabled", error)
        } catch (error: Exception) {
            // Never let a core-loading failure (corrupt persisted material, storage
            // error, identity mismatch fallout) crash app startup over a feature
            // every other screen in the app already works without.
            Log.e(TAG, "native core initialization failed; secure core disabled", error)
        }
    }

    fun isLoaded(): Boolean = core != null

    fun instance(): NativeSecureCore? = core

    fun version(): String = core?.version() ?: "native core not loaded"

    /**
     * Round-trips a real message through [NativeSecureCore.encryptMessage] and
     * [NativeSecureCore.decryptMessage] (X25519 + ML-KEM hybrid agreement,
     * XChaCha20-Poly1305, Ed25519 signing — see `core/src/envelope.rs`),
     * encrypting to this device's own key package. This is the first genuine
     * exercise of the FFI wire format (JSON/base64 request and response
     * shapes) on real hardware, distinct from `version()`/`isLoaded()` which
     * only prove the library linked, not that the crypto pipeline itself
     * works end-to-end.
     */
    fun runSelfTest(): Boolean {
        val secureCore = core ?: return false
        return try {
            val now = System.currentTimeMillis() / 1000
            val keyPackage = JSONObject(
                String(
                    Base64.decode(
                        secureCore.generateKeyPackage("self-test-user", "self-test-device", (now + 3600).toULong()),
                        Base64.DEFAULT,
                    ),
                    StandardCharsets.UTF_8,
                ),
            )
            val plaintext = "linqa native-core self-test".toByteArray(StandardCharsets.UTF_8)

            val encryptRequest = JSONObject().apply {
                put("recipient_encryption_public_key", keyPackage.getJSONArray("encryption_public_key"))
                put("recipient_pq_encryption_public_key", keyPackage.getJSONArray("pq_encryption_public_key"))
                put("sender_user_id", "self-test-user")
                put("sender_device_id", "self-test-device")
                put("recipient_user_id", "self-test-user")
                put("recipient_device_id", "self-test-device")
                put("message_id", "self-test-${now}")
                put("plaintext", plaintext.toJsonArray())
                put("created_at_unix", now)
                put("expires_at_unix", now + 60)
            }
            val envelopeJson = JSONObject(
                String(
                    Base64.decode(secureCore.encryptMessage(encryptRequest.toString()), Base64.DEFAULT),
                    StandardCharsets.UTF_8,
                ),
            )

            val decryptRequest = JSONObject().apply {
                put("expected_recipient_device_id", "self-test-device")
                put("sender_signing_public_key", keyPackage.getJSONArray("signing_public_key"))
                put("envelope", envelopeJson)
                put("now_unix", now)
            }
            val decryptRequestB64 = Base64.encodeToString(
                decryptRequest.toString().toByteArray(StandardCharsets.UTF_8),
                Base64.NO_WRAP,
            )
            val decrypted = Base64.decode(secureCore.decryptMessage(decryptRequestB64), Base64.DEFAULT)

            decrypted.contentEquals(plaintext)
        } catch (error: Exception) {
            Log.e(TAG, "self-test threw", error)
            false
        }
    }

    private fun ByteArray.toJsonArray(): JSONArray {
        val array = JSONArray()
        for (b in this) array.put(b.toInt() and 0xFF)
        return array
    }

    private fun JSONArray.toByteArray(): ByteArray =
        ByteArray(length()) { i -> getInt(i).toByte() }

    private fun decodeMaterialJson(materialB64: String): JSONObject =
        JSONObject(String(Base64.decode(materialB64, Base64.DEFAULT), StandardCharsets.UTF_8))

    private fun loadOrCreateCore(context: Context, deviceIdentity: DeviceIdentity): NativeSecureCore {
        val deviceKeys = deviceIdentity.ensureKeys() // generates on first run; idempotent otherwise
        val prefs = encryptedPrefs(context)
        val existing = prefs.getString(KEY_MATERIAL, null)
        val boundPublicKey = prefs.getString(KEY_BOUND_SIGNING_PUBLIC, null)?.let {
            Base64.decode(it, Base64.NO_WRAP)
        }
        if (existing != null && boundPublicKey != null && boundPublicKey.contentEquals(deviceKeys.signingPublicKey)) {
            return NativeSecureCore.fromKeyMaterial(existing)
        }
        if (existing != null) {
            Log.w(TAG, "stored core identity predates or diverges from the enrolled device identity; rebinding")
        }

        val bound = bindToDeviceIdentity(deviceIdentity)
        prefs.edit()
            .putString(KEY_MATERIAL, bound.exportKeyMaterial())
            .putString(KEY_BOUND_SIGNING_PUBLIC, Base64.encodeToString(deviceKeys.signingPublicKey, Base64.NO_WRAP))
            .apply()
        return bound
    }

    /**
     * Splices the already-enrolled Ed25519 signing key and X25519 encryption
     * key (`DeviceIdentity`, BouncyCastle-backed, registered with the server
     * during device enrollment — see `network/EnrollmentApi.kt`) into a
     * freshly generated core identity, keeping only that identity's ML-KEM-768
     * secret (the one piece DeviceIdentity cannot produce; there is no
     * pure-Kotlin PQ implementation here). The result is a core identity whose
     * `signing_public_key` matches `device.signing_public_key` on the server,
     * so published key packages pass `parseAndVerifyKeyPackage`
     * (`server/src/auth/key-package-proof.ts`).
     *
     * The raw private keys only ever exist as a [SecretBytes]-wrapped blob
     * for the duration of this one call — see
     * `DeviceIdentity.sealNativeKeyMaterial`, the sole boundary that produces
     * them. There is no general-purpose "give me the private key" API
     * anywhere in this app.
     */
    private fun bindToDeviceIdentity(deviceIdentity: DeviceIdentity): NativeSecureCore {
        val fresh = NativeSecureCore()
        val pqEncryptionSecret = decodeMaterialJson(fresh.exportKeyMaterial())
            .getJSONArray("pq_encryption_secret")
            .toByteArray()
        val sealed = try {
            deviceIdentity.sealNativeKeyMaterial(pqEncryptionSecret)
        } finally {
            pqEncryptionSecret.fill(0)
        }

        sealed.use { secret ->
            return secret.useBytes { materialBytes ->
                val materialB64 = Base64.encodeToString(materialBytes, Base64.NO_WRAP)
                NativeSecureCore.fromKeyMaterial(materialB64)
            }
        }
    }

    private fun encryptedPrefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }
}
