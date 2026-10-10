package expo.modules.linqasecure

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyPairGenerator
import java.security.Signature
import android.util.Base64

class LinqaSecureCoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LinqaSecureCore")

    Function("isAvailable") {
      true
    }

    AsyncFunction("generateKeys") { userId: String ->
      val generator = KeyPairGenerator.getInstance("EC")
      generator.initialize(256)
      val pair = generator.generateKeyPair()
      val identity = Base64.encodeToString(pair.public.encoded, Base64.NO_WRAP)
      val signed = generator.generateKeyPair()
      val signature = Signature.getInstance("SHA256withECDSA")
      signature.initSign(pair.private)
      signature.update(signed.public.encoded)
      mapOf(
        "userId" to userId,
        "identityKey" to identity,
        "signedPreKey" to Base64.encodeToString(signed.public.encoded, Base64.NO_WRAP),
        "signature" to Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
      )
    }

    AsyncFunction("publishKeys") { _: Map<String, String> ->
      Unit
    }

    AsyncFunction("hasRemoteKeys") { _: String ->
      false
    }

    AsyncFunction("encrypt") { _: String, _: String ->
      throw IllegalStateException("No session for peer. Refusing plaintext.")
    }

    AsyncFunction("decrypt") { _: String, _: String ->
      throw IllegalStateException("No session for peer.")
    }
  }
}
