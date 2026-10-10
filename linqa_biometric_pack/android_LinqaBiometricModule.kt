package com.linqa.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricPrompt
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature

class LinqaBiometricModule {
  private val provider = "AndroidKeyStore"

  fun createSigningKey(alias: String): ByteArray {
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, provider)
    val spec = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
    )
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(true)
      .build()
    generator.initialize(spec)
    val kp = generator.generateKeyPair()
    return kp.public.encoded // RFC 5480 SubjectPublicKeyInfo DER
  }

  fun cryptoObject(alias: String): BiometricPrompt.CryptoObject {
    val ks = KeyStore.getInstance(provider).apply { load(null) }
    val privateKey = ks.getKey(alias, null) as java.security.PrivateKey
    val signature = Signature.getInstance("SHA256withECDSA")
    signature.initSign(privateKey)
    return BiometricPrompt.CryptoObject(signature)
  }

  // In Activity/Fragment, authenticate with BIOMETRIC_STRONG and this CryptoObject.
  // On AuthenticationResult, call:
  fun finishSignature(result: BiometricPrompt.AuthenticationResult, payload: ByteArray): ByteArray {
    val signature = result.cryptoObject?.signature ?: error("Missing biometric crypto object")
    signature.update(payload)
    return signature.sign()
  }
}
