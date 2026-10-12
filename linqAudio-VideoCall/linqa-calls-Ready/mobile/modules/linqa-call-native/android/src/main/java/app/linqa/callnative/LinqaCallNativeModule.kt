package app.linqa.callnative

import android.os.Build
import com.google.firebase.messaging.FirebaseMessaging
import com.oney.WebRTCModule.WebRTCModuleOptions
import com.oney.WebRTCModule.videoEffects.ProcessorProvider
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessorFactoryInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * JS face of the native call helpers on Android:
 *  - registers the "linqa-blur" camera effect with react-native-webrtc
 *  - turns on react-native-webrtc's own screen-capture foreground service
 *    (required on Android 14 for getDisplayMedia)
 *  - FCM token for ringing, incoming-call notification actions
 *  - the foreground service that keeps a call alive in the background
 */
class LinqaCallNativeModule : Module() {
  companion object {
    private var current: WeakReference<LinqaCallNativeModule>? = null

    fun emitPushToken(token: String) {
      current?.get()?.sendEvent("onPushToken", mapOf("token" to token))
    }

    /** Returns false when JS isn't running, so the caller can remember it. */
    fun emitAction(action: String, callId: String): Boolean {
      val m = current?.get() ?: return false
      m.sendEvent("onCallAction", mapOf("action" to action, "callId" to callId))
      return true
    }
  }

  private val ctx get() = requireNotNull(appContext.reactContext) { "No React context" }

  override fun definition() = ModuleDefinition {
    Name("LinqaCallNative")

    @Suppress("DEPRECATION")
    Constants(
      "blurSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N),
      "screenShareSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
    )

    Events("onVoipToken", "onPushToken", "onCallAction")

    OnCreate {
      current = WeakReference(this@LinqaCallNativeModule)
      WebRTCModuleOptions.getInstance().enableMediaProjectionService = true
      ProcessorProvider.addProcessor("linqa-blur", object : VideoFrameProcessorFactoryInterface {
        override fun build(): VideoFrameProcessor = LinqaBlurProcessor()
      })
      appContext.reactContext?.let { IncomingCallNotifier.ensureChannels(it) }
    }

    OnDestroy {
      if (current?.get() === this@LinqaCallNativeModule) current = null
    }

    Function("getVoipToken") { null as String? }

    AsyncFunction("getPushToken") { promise: Promise ->
      val cached = PushTokenStore.get(ctx)
      if (cached != null) {
        promise.resolve(cached)
      } else {
        try {
          FirebaseMessaging.getInstance().token
            .addOnSuccessListener { t -> PushTokenStore.save(ctx, t); promise.resolve(t) }
            .addOnFailureListener { promise.resolve(null) }
        } catch (e: IllegalStateException) {
          // Firebase isn't configured (no google-services.json).
          promise.resolve(null)
        }
      }
    }

    Function("takeDeclinedCalls") { CallActionReceiver.takeDeclined(ctx) }

    Function("cancelIncomingCall") { callId: String -> IncomingCallNotifier.cancel(ctx, callId) }

    Function("startCallService") { callId: String, video: Boolean -> LinqaCallService.start(ctx, callId, video) }

    Function("stopCallService") { LinqaCallService.stop(ctx) }

    Function("stopScreenShareBroadcast") { }
  }
}
