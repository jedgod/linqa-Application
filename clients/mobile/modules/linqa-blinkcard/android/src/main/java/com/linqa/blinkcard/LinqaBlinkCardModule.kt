package com.linqa.blinkcard

import com.microblink.blinkcard.MicroblinkSDK
import com.microblink.blinkcard.activity.result.ResultStatus
import com.microblink.blinkcard.activity.result.contract.MbScan
import com.microblink.blinkcard.entities.recognizers.Recognizer
import com.microblink.blinkcard.entities.recognizers.RecognizerBundle
import com.microblink.blinkcard.entities.recognizers.blinkcard.BlinkCardRecognizer
import com.microblink.blinkcard.licence.exception.LicenceKeyException
import com.microblink.blinkcard.licence.exception.LicenceLockedException
import com.microblink.blinkcard.licence.exception.RemoteLicenceCheckException
import com.microblink.blinkcard.uisettings.BlinkCardUISettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * On-device card scanning with Microblink's BlinkCard Android SDK 2.x.
 *
 * The camera and recognition run on the phone. The security code is never read: the recognizer is told not to extract it, and
 * nothing here puts it in the result. Card details are returned to JavaScript once and are not logged or stored.
 */
class LinqaBlinkCardModule : Module() {
  private val requestCode = 0x4C42
  private var pending: Promise? = null
  private val contract = MbScan()

  /** Machine-readable reason a license was refused: bound to another app, needs an online check, or simply invalid. */
  private fun licenseCode(cause: LicenceKeyException): String = when (cause) {
    is LicenceLockedException -> "BLINKCARD_LICENSE_LOCKED"
    is RemoteLicenceCheckException -> "BLINKCARD_LICENSE_ONLINE_CHECK_FAILED"
    else -> "BLINKCARD_INVALID_LICENSE"
  }

  override fun definition() = ModuleDefinition {
    Name("LinqaBlinkCard")

    AsyncFunction("scanCard") { licenseKey: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) { promise.reject("BLINKCARD_NO_ACTIVITY", "No foreground activity", null); return@AsyncFunction }
      if (pending != null) { promise.reject("BLINKCARD_BUSY", "A card scan is already in progress", null); return@AsyncFunction }
      if (licenseKey.isBlank()) { promise.reject("BLINKCARD_LICENSE_MISSING", "BlinkCard license key is missing", null); return@AsyncFunction }
      try {
        MicroblinkSDK.setLicenseKey(licenseKey, activity)
      } catch (cause: LicenceKeyException) {
        promise.reject(licenseCode(cause), "The BlinkCard license key was rejected", cause)
        return@AsyncFunction
      } catch (cause: Throwable) {
        promise.reject("BLINKCARD_SDK_INIT_FAILED", "Card scanner could not start", cause)
        return@AsyncFunction
      }
      try {
        val recognizer = BlinkCardRecognizer().apply {
          setExtractCvv(false)
          setExtractOwner(true)
          setExtractExpiryDate(true)
        }
        val settings = BlinkCardUISettings(RecognizerBundle(recognizer))
        pending = promise
        activity.startActivityForResult(contract.createIntent(activity, settings), requestCode)
      } catch (cause: Throwable) {
        pending = null
        promise.reject("BLINKCARD_LAUNCH_FAILED", "Unable to open the card scanner", cause)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != requestCode) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      try {
        val outcome = contract.parseResult(payload.resultCode, payload.data)
        when (outcome.resultStatus) {
          ResultStatus.CANCELLED -> promise.resolve(mapOf("status" to "canceled"))
          ResultStatus.FINISHED -> {
            val data = outcome.result
            if (data == null) { promise.reject("BLINKCARD_NO_RESULT", "The scanner returned no result", null); return@OnActivityResult }
            val recognizer = RecognizerBundle.createFromIntent(data)?.recognizers?.firstOrNull() as? BlinkCardRecognizer
            val result = recognizer?.result
            if (result == null || result.resultState != Recognizer.Result.State.Valid) {
              promise.reject("BLINKCARD_NO_CARD_NUMBER", "No card number was read", null); return@OnActivityResult
            }
            val number = result.cardNumber
            if (number.isNullOrBlank()) { promise.reject("BLINKCARD_NO_CARD_NUMBER", "No card number was read", null); return@OnActivityResult }
            val expiry = result.expiryDate?.date
            promise.resolve(mapOf(
              "status" to "scanned",
              "card" to mapOf(
                "number" to number,
                "expMonth" to expiry?.month,
                "expYear" to expiry?.year,
                "cvv" to null,
                "holderName" to result.owner,
                "issuingNetwork" to result.issuer?.name
              )
            ))
          }
          else -> {
            val cause = outcome.exception
            if (cause is LicenceKeyException) promise.reject(licenseCode(cause), "The BlinkCard license key was rejected", cause)
            else promise.reject("BLINKCARD_SDK_INIT_FAILED", "Card scanner could not start", cause)
          }
        }
      } catch (cause: Throwable) {
        promise.reject("BLINKCARD_RESULT_FAILED", "Unable to read the card scan", cause)
      }
    }

    OnDestroy { pending = null }
  }
}
