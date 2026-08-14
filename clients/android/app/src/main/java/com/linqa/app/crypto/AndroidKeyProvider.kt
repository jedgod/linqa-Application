package com.linqa.app.crypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.security.KeyFactory
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class AndroidKeyProvider {
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun createWrappingKey(alias: String) {
        if (keyStore.containsAlias(alias)) return
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        generator.generateKey()
    }

    fun wrapKey(alias: String, rawKey: ByteArray, context: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, requireKey(alias))
        cipher.updateAAD(context)
        return cipher.iv + cipher.doFinal(rawKey)
    }

    fun unwrapKey(alias: String, wrappedKey: ByteArray, context: ByteArray): ByteArray {
        require(wrappedKey.size >= 29) { "invalid wrapped key" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, requireKey(alias), GCMParameterSpec(128, wrappedKey.copyOfRange(0, 12)))
        cipher.updateAAD(context)
        return cipher.doFinal(wrappedKey.copyOfRange(12, wrappedKey.size))
    }

    fun deleteKey(alias: String) = keyStore.deleteEntry(alias)

    @Suppress("DEPRECATION")
    fun supportsHardwareBackedKeys(alias: String): Boolean {
        val key = keyStore.getKey(alias, null) as? SecretKey ?: return false
        val keyInfo = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore")
            .getKeySpec(key, KeyInfo::class.java)
        return keyInfo.isInsideSecureHardware
    }

    private fun requireKey(alias: String): SecretKey =
        keyStore.getKey(alias, null) as? SecretKey ?: error("wrapping key not found")
}