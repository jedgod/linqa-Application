package com.linqa.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.security.KeyFactory
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Non-exportable AndroidKeyStore AES key used only to wrap Rust identity material. */
class AndroidKeyCustody {
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun createWrappingKey(alias: String) {
        if (store.containsAlias(alias)) return
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        generator.generateKey()
    }

    fun wrap(alias: String, plaintext: ByteArray, aad: ByteArray): ByteArray {
        createWrappingKey(alias)
        val key = store.getKey(alias, null) as SecretKey
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(aad)
        return cipher.iv + cipher.doFinal(plaintext)
    }

    fun unwrap(alias: String, wrapped: ByteArray, aad: ByteArray): ByteArray {
        require(wrapped.size > 28) { "invalid wrapped identity" }
        val key = store.getKey(alias, null) as SecretKey
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, wrapped.copyOfRange(0, 12)))
        cipher.updateAAD(aad)
        return cipher.doFinal(wrapped.copyOfRange(12, wrapped.size))
    }

    fun protectionLevel(alias: String): String {
        val key = store.getKey(alias, null) as SecretKey
        val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
        return if (info.isInsideSecureHardware) "HARDWARE_BACKED" else "OS_PROTECTED"
    }

    fun delete(alias: String) = store.deleteEntry(alias)
}
