import ExpoModulesCore
import Foundation
import LocalAuthentication
import Security
import DeviceCheck
import CryptoKit

public final class LinqaBiometricModule: Module {
  private let service = "com.linqa.biometric.signing."
  private func failure(_ message: String) -> NSError { NSError(domain: "LinqaBiometric", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
  private func tag(_ alias: String) throws -> Data {
    guard alias.range(of: "^linqa\\.bio\\.[A-Za-z0-9.-]{1,100}$", options: .regularExpression) != nil else { throw failure("INVALID_BIOMETRIC_ALIAS") }
    return Data((service + alias).utf8)
  }
  public func definition() -> ModuleDefinition {
    Name("LinqaBiometric")
    AsyncFunction("isAvailable") { () -> [String: Any] in
      let context = LAContext()
      let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
      return ["available": available, "strong": available, "type": available ? (context.biometryType == .faceID ? "FACE" : "FINGERPRINT") : "NONE"]
    }
    AsyncFunction("createSigningKey") { (alias: String, nonceBase64: String) async throws -> [String: Any] in
      guard let nonce = Data(base64Encoded: nonceBase64), nonce.count == 32 else { throw self.failure("INVALID_ENROLLMENT_NONCE") }
      let tag = try self.tag(alias)
      let existing: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag, kSecReturnRef as String: true, kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail]
      guard SecItemCopyMatching(existing as CFDictionary, nil) == errSecItemNotFound else { throw self.failure("BIOMETRIC_ALIAS_EXISTS") }
      var error: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &error) else { throw self.failure("BIOMETRIC_ACCESS_CONTROL_FAILED") }
      let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits as String: 256, kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave, kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: tag, kSecAttrAccessControl as String: access]]
      guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error), let publicKey = SecKeyCopyPublicKey(key), let raw = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?, raw.count == 65, raw.first == 4 else { throw self.failure("BIOMETRIC_SECURE_ENCLAVE_KEY_FAILED") }
      let prefix = Data([0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00])
      let spki = prefix + raw
      var evidence: [String: Any] = ["provider": "NOT_SUPPORTED"]
      if DCAppAttestService.shared.isSupported {
        do {
          let appKeyId = try await DCAppAttestService.shared.generateKey()
          // Domain-separated attestation binds the server nonce to this biometric signing key.
          let clientData = Data("LINQA-BIOMETRIC-ENROLL-V5".utf8) + nonce + spki
          let clientDataHash = Data(SHA256.hash(data: clientData))
          let object = try await DCAppAttestService.shared.attestKey(appKeyId, clientDataHash: clientDataHash)
          evidence = ["provider": "APPLE_APP_ATTEST", "appAttestKeyId": appKeyId, "attestationObjectBase64": object.base64EncodedString(), "clientDataHashBase64": clientDataHash.base64EncodedString()]
        } catch { evidence = ["provider": "NOT_SUPPORTED", "reason": "App Attest failed; production enrollment must be denied"] }
      }
      return ["publicKeySpkiBase64": spki.base64EncodedString(), "attestation": evidence]
    }
    AsyncFunction("sign") { (alias: String, payloadBase64: String, prompt: String) -> [String: String] in
      guard let payload = Data(base64Encoded: payloadBase64), !payload.isEmpty, payload.count <= 16384 else { throw self.failure("INVALID_BIOMETRIC_PAYLOAD") }
      let context = LAContext()
      context.localizedReason = prompt
      context.localizedFallbackTitle = ""
      context.touchIDAuthenticationAllowableReuseDuration = 0
      let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: try self.tag(alias), kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecReturnRef as String: true, kSecUseAuthenticationContext as String: context]
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let item else { throw self.failure("BIOMETRIC_KEY_MISSING_OR_AUTHENTICATION_CANCELED") }
      let key = item as! SecKey
      var error: Unmanaged<CFError>?
      guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, payload as CFData, &error) as Data? else { throw self.failure("BIOMETRIC_SIGNATURE_FAILED") }
      return ["signatureBase64": signature.base64EncodedString()]
    }
    AsyncFunction("deleteKey") { (alias: String) in
      let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: try self.tag(alias), kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom]
      let status = SecItemDelete(query as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw self.failure("BIOMETRIC_KEY_DELETE_FAILED") }
    }
  }
}
