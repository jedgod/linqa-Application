package com.linqa.biometric

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

class LinqaBiometricModule : Module() {
  private var signing = false
  private fun alias(value: String): String {
    require(Regex("^linqa\\.bio\\.[A-Za-z0-9.-]{1,100}$").matches(value)) { "INVALID_BIOMETRIC_ALIAS" }
    return value
  }
  private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun encode(value: ByteArray) = Base64.encodeToString(value, Base64.NO_WRAP)
  override fun definition() = ModuleDefinition {
    Name("LinqaBiometric")
    AsyncFunction("isAvailable") {
      val context = appContext.reactContext ?: error("BIOMETRIC_CONTEXT_UNAVAILABLE")
      val strong = BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
      mapOf("available" to strong, "strong" to strong, "type" to if (strong) "OTHER" else "NONE")
    }
    AsyncFunction("createSigningKey") { value: String, nonceBase64: String ->
      val keyAlias = alias(value)
      val keyStore = store()
      require(!keyStore.containsAlias(keyAlias)) { "BIOMETRIC_ALIAS_EXISTS" }
      val nonce = Base64.decode(nonceBase64, Base64.DEFAULT)
      require(nonce.size == 32) { "INVALID_ENROLLMENT_NONCE" }
      val builder = KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(true)
        .setInvalidatedByBiometricEnrollment(true)
        .setAttestationChallenge(nonce)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
      else builder.setUserAuthenticationValidityDurationSeconds(-1)
      val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
      generator.initialize(builder.build())
      val pair = generator.generateKeyPair()
      val info = KeyFactory.getInstance(pair.private.algorithm, "AndroidKeyStore").getKeySpec(pair.private, KeyInfo::class.java)
      val hardware = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) info.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT || info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX else info.isInsideSecureHardware
      if (!hardware) { keyStore.deleteEntry(keyAlias); error("BIOMETRIC_HARDWARE_KEY_REQUIRED") }
      mapOf("publicKeySpkiBase64" to encode(pair.public.encoded), "attestation" to mapOf("provider" to "ANDROID_KEY_ATTESTATION", "certificatesBase64" to keyStore.getCertificateChain(keyAlias).map { encode(it.encoded) }))
    }
    AsyncFunction("sign") { value: String, payloadBase64: String, prompt: String, promise: Promise ->
      if (signing) { promise.reject("BIOMETRIC_BUSY", "A signature is already pending", null); return@AsyncFunction }
      val activity = appContext.currentActivity as? FragmentActivity
      if (activity == null) { promise.reject("BIOMETRIC_ACTIVITY_UNAVAILABLE", "Open the app to authenticate", null); return@AsyncFunction }
      try {
        val payload = Base64.decode(payloadBase64, Base64.DEFAULT)
        require(payload.isNotEmpty() && payload.size <= 16384)
        val privateKey = store().getKey(alias(value), null) as? PrivateKey ?: error("BIOMETRIC_KEY_MISSING")
        val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey) }
        signing = true
        val biometric = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationError(code: Int, message: CharSequence) {
            signing = false
            promise.reject("BIOMETRIC_CANCELED_OR_FAILED", message.toString(), null)
          }
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            signing = false
            try {
              val approved = result.cryptoObject?.signature ?: error("BIOMETRIC_CRYPTO_OBJECT_MISSING")
              approved.update(payload)
              promise.resolve(mapOf("signatureBase64" to encode(approved.sign())))
            } catch (error: Exception) { promise.reject("BIOMETRIC_SIGN_FAILED", error.message, error) }
          }
        })
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(prompt.take(120)).setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG).setNegativeButtonText("Cancel").build()
        biometric.authenticate(info, BiometricPrompt.CryptoObject(signature))
      } catch (error: Exception) { signing = false; promise.reject("BIOMETRIC_SIGN_FAILED", error.message, error) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("deleteKey") { value: String -> store().deleteEntry(alias(value)) }
  }
}
