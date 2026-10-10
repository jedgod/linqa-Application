import Foundation
import LocalAuthentication
import Security

final class LinqaBiometricModule {
  private let service = "com.linqa.biometric.signing"

  func createKey(alias: String) throws -> Data {
    let access = SecAccessControlCreateWithFlags(nil,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      [.privateKeyUsage, .biometryCurrentSet], nil)!

    let attrs: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: Data((service+"."+alias).utf8),
        kSecAttrAccessControl as String: access
      ]
    ]
    var error: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(attrs as CFDictionary, &error),
          let publicKey = SecKeyCopyPublicKey(privateKey),
          let raw = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      throw error!.takeRetainedValue() as Error
    }
    // Production bridge should convert the raw ANSI X9.63 P-256 point to RFC 5480 SPKI DER.
    return raw
  }

  func sign(alias: String, payload: Data, reason: String) throws -> Data {
    let context = LAContext()
    context.localizedReason = reason
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: Data((service+"."+alias).utf8),
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
      kSecUseAuthenticationContext as String: context
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let key = item as! SecKey? else { throw NSError(domain:"LinqaBio",code:1) }
    var error: Unmanaged<CFError>?
    guard let sig = SecKeyCreateSignature(key,.ecdsaSignatureMessageX962SHA256,
                                           payload as CFData,&error) as Data? else {
      throw error!.takeRetainedValue() as Error
    }
    return sig
  }
}
