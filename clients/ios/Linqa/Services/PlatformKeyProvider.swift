import CryptoKit
import Foundation
import Security

enum PlatformKeyProviderError: Error {
    case keyNotFound
    case keychain(OSStatus)
    case invalidWrappedKey
}

struct PlatformKeyProvider {
    private let service = "com.linqa.key-custody"

    func createWrappingKey(alias: String) throws {
        if try loadKey(alias: alias) != nil { return }
        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: alias,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw PlatformKeyProviderError.keychain(status) }
    }

    func wrapKey(alias: String, rawKey: Data, context: Data) throws -> Data {
        guard let key = try loadKey(alias: alias) else { throw PlatformKeyProviderError.keyNotFound }
        let sealed = try AES.GCM.seal(rawKey, using: key, authenticating: context)
        guard let combined = sealed.combined else { throw PlatformKeyProviderError.invalidWrappedKey }
        return combined
    }

    func unwrapKey(alias: String, wrappedKey: Data, context: Data) throws -> Data {
        guard let key = try loadKey(alias: alias) else { throw PlatformKeyProviderError.keyNotFound }
        let box = try AES.GCM.SealedBox(combined: wrappedKey)
        return try AES.GCM.open(box, using: key, authenticating: context)
    }

    func deleteKey(alias: String) throws {
        let status = SecItemDelete(baseQuery(alias: alias) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw PlatformKeyProviderError.keychain(status)
        }
    }

    func supportsHardwareBackedKeys() -> Bool {
        false
    }

    private func loadKey(alias: String) throws -> SymmetricKey? {
        var query = baseQuery(alias: alias)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw PlatformKeyProviderError.keychain(status)
        }
        return SymmetricKey(data: data)
    }

    private func baseQuery(alias: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: alias,
        ]
    }
}