package com.linqa.securecore

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.linqa_core.NativeCoreException
import uniffi.linqa_core.NativeSecureCore

/**
 * Bridge to the Rust secure core (linqa-core, through its UniFFI bindings). It does no cryptography itself: every operation is
 * one call into the core, and any failure reaches JavaScript as a coded error, never as a partial result.
 *
 * The core is created once from the device's key material by `createCore`. Until then every call fails with
 * SECURE_CORE_NOT_CREATED, so nothing can run on a core that was never set up.
 */
class LinqaSecureCoreModule : Module() {
  @Volatile private var core: NativeSecureCore? = null
  private val lock = Any()

  private fun current(): NativeSecureCore = core ?: throw CodedException("SECURE_CORE_NOT_CREATED", "The secure core has not been created.", null)

  private fun <T> guarded(block: () -> T): T = try {
    block()
  } catch (e: NativeCoreException.InvalidInput) {
    throw CodedException("SECURE_CORE_INVALID_INPUT", "The secure core rejected its input.", null)
  } catch (e: NativeCoreException.AuthenticationFailed) {
    throw CodedException("SECURE_CORE_AUTHENTICATION_FAILED", "The secure core could not authenticate this message.", null)
  }

  override fun definition() = ModuleDefinition {
    Name("LinqaSecureCore")

    /** keyMaterialB64 null: a fresh random identity (used to draw a post-quantum key). Otherwise the device's own key material. */
    AsyncFunction("createCore") { keyMaterialB64: String? ->
      guarded {
        val made = if (keyMaterialB64 == null) NativeSecureCore() else NativeSecureCore.fromKeyMaterial(keyMaterialB64)
        synchronized(lock) { core?.close(); core = made }
      }
      true
    }
    AsyncFunction("destroyCore") { synchronized(lock) { core?.close(); core = null }; true }

    AsyncFunction("version") { guarded { current().version() } }
    AsyncFunction("protectionLevel") { guarded { current().protectionLevel() } }
    AsyncFunction("exportKeyMaterial") { guarded { current().exportKeyMaterial() } }
    AsyncFunction("generateKeyPackage") { userId: String, deviceId: String, expiresAt: Double ->
      if (expiresAt < 0 || expiresAt > 4.0e12) throw CodedException("SECURE_CORE_INVALID_INPUT", "Invalid key package expiry.", null)
      guarded { current().generateKeyPackage(userId, deviceId, expiresAt.toLong().toULong()) }
    }
    AsyncFunction("verifyKeyPackage") { packageB64: String -> guarded { current().verifyKeyPackage(packageB64) }; true }
    AsyncFunction("sealCallKey") { x25519: String, mlkem768: String, plaintext: String, aad: String -> guarded { current().sealCallKey(x25519, mlkem768, plaintext, aad) } }
    AsyncFunction("openCallKey") { sealed: String, aad: String -> guarded { current().openCallKey(sealed, aad) } }
    AsyncFunction("signCallMessage") { message: String -> guarded { current().signCallMessage(message) } }
    AsyncFunction("encryptMessage") { requestJson: String -> guarded { current().encryptMessage(requestJson) } }
    AsyncFunction("decryptMessage") { envelopeB64: String -> guarded { current().decryptMessage(envelopeB64) } }
    AsyncFunction("verifyTransparencyProof") { proofB64: String -> guarded { current().verifyTransparencyProof(proofB64) }; true }
  }
}
