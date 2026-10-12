import ExpoModulesCore
import Foundation

/// Bridge to the Rust secure core (linqa-core, through its UniFFI Swift bindings). Like the Android bridge it does no cryptography
/// itself: every operation is one call into the core, and any failure reaches JavaScript as a coded error, never a partial result.
///
/// The core is created once from the device's key material by `createCore`. Until then every call fails with
/// SECURE_CORE_NOT_CREATED, so nothing can run on a core that was never set up.
public class LinqaSecureCoreModule: Module {
  private var core: NativeSecureCore?
  private let lock = NSLock()

  private func current() throws -> NativeSecureCore {
    lock.lock(); defer { lock.unlock() }
    guard let core = core else {
      throw Exception(name: "SECURE_CORE_NOT_CREATED", description: "The secure core has not been created.")
    }
    return core
  }

  private func guarded<T>(_ block: () throws -> T) throws -> T {
    do {
      return try block()
    } catch NativeCoreError.InvalidInput {
      throw Exception(name: "SECURE_CORE_INVALID_INPUT", description: "The secure core rejected its input.")
    } catch NativeCoreError.AuthenticationFailed {
      throw Exception(name: "SECURE_CORE_AUTHENTICATION_FAILED", description: "The secure core could not authenticate this message.")
    }
  }

  public func definition() -> ModuleDefinition {
    Name("LinqaSecureCore")

    // keyMaterialB64 nil: a fresh random identity (used to draw a post-quantum key). Otherwise the device's own key material.
    AsyncFunction("createCore") { (keyMaterialB64: String?) -> Bool in
      let made: NativeSecureCore = try self.guarded {
        if let material = keyMaterialB64 { return try NativeSecureCore.fromKeyMaterial(keyMaterialB64: material) }
        return try NativeSecureCore()
      }
      self.lock.lock(); self.core = made; self.lock.unlock()
      return true
    }

    AsyncFunction("destroyCore") { () -> Bool in
      self.lock.lock(); self.core = nil; self.lock.unlock()
      return true
    }

    AsyncFunction("version") { () -> String in try self.current().version() }
    AsyncFunction("protectionLevel") { () -> String in try self.current().protectionLevel() }
    AsyncFunction("exportKeyMaterial") { () -> String in try self.guarded { try self.current().exportKeyMaterial() } }

    AsyncFunction("generateKeyPackage") { (userId: String, deviceId: String, expiresAt: Double) -> String in
      if expiresAt < 0 || expiresAt > 4.0e12 {
        throw Exception(name: "SECURE_CORE_INVALID_INPUT", description: "Invalid key package expiry.")
      }
      return try self.guarded { try self.current().generateKeyPackage(userId: userId, deviceId: deviceId, expiresAt: UInt64(expiresAt)) }
    }

    AsyncFunction("verifyKeyPackage") { (packageB64: String) -> Bool in
      try self.guarded { try self.current().verifyKeyPackage(packageB64: packageB64) }
      return true
    }

    AsyncFunction("sealCallKey") { (x25519: String, mlkem768: String, plaintext: String, aad: String) -> String in
      try self.guarded { try self.current().sealCallKey(x25519: x25519, mlkem768: mlkem768, plaintext: plaintext, aad: aad) }
    }
    AsyncFunction("openCallKey") { (sealed: String, aad: String) -> String in
      try self.guarded { try self.current().openCallKey(sealed: sealed, aad: aad) }
    }
    AsyncFunction("signCallMessage") { (message: String) -> String in
      try self.guarded { try self.current().signCallMessage(message: message) }
    }
    AsyncFunction("encryptMessage") { (requestJson: String) -> String in
      try self.guarded { try self.current().encryptMessage(requestJson: requestJson) }
    }

    AsyncFunction("decryptMessage") { (requestB64: String) -> String in
      try self.guarded { try self.current().decryptMessage(requestB64: requestB64) }
    }

    AsyncFunction("verifyTransparencyProof") { (proofB64: String) -> Bool in
      try self.guarded { try self.current().verifyTransparencyProof(proofB64: proofB64) }
      return true
    }
  }
}
