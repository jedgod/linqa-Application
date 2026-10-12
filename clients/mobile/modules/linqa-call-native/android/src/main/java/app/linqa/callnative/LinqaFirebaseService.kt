package app.linqa.callnative

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives the server's high-priority data messages:
 *   { type: "call-ring",   callId, kind, fromUserId }
 *   { type: "call-cancel", callId }
 * and shows or removes the incoming-call notification. Runs with the app
 * killed. If the app already uses @react-native-firebase/messaging, only one
 * FirebaseMessagingService receives messages: forward these two types to
 * IncomingCallNotifier from that one instead.
 */
class LinqaFirebaseService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    val callId = data["callId"] ?: return
    when (data["type"]) {
      "call-ring" -> IncomingCallNotifier.show(applicationContext, callId, data["kind"] == "video")
      "call-cancel" -> IncomingCallNotifier.cancel(applicationContext, callId)
    }
  }

  override fun onNewToken(token: String) {
    PushTokenStore.save(applicationContext, token)
    LinqaCallNativeModule.emitPushToken(token)
  }
}
