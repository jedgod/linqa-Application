import ExpoModulesCore
import CryptoKit
import Foundation

public class LinqaSecureCoreModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LinqaSecureCore")

    Function("isAvailable") { () -> Bool in
      true
    }

    AsyncFunction("generateKeys") { (userId: String) -> [String: String] in
      let identity = P256.Signing.PrivateKey()
      let signed = P256.Signing.PrivateKey()
      let signature = try identity.signature(for: signed.publicKey.rawRepresentation)
      return [
        "userId": userId,
        "identityKey": identity.publicKey.rawRepresentation.base64EncodedString(),
        "signedPreKey": signed.publicKey.rawRepresentation.base64EncodedString(),
        "signature": signature.rawRepresentation.base64EncodedString()
      ]
    }

    AsyncFunction("publishKeys") { (_: [String: String]) in }

    AsyncFunction("hasRemoteKeys") { (_: String) -> Bool in
      false
    }

    AsyncFunction("encrypt") { (_: String, _: String) -> String in
      throw NSError(domain: "LinqaSecureCore", code: 1, userInfo: [NSLocalizedDescriptionKey: "No session for peer. Refusing plaintext."])
    }

    AsyncFunction("decrypt") { (_: String, _: String) -> String in
      throw NSError(domain: "LinqaSecureCore", code: 1, userInfo: [NSLocalizedDescriptionKey: "No session for peer."])
    }
  }
}
