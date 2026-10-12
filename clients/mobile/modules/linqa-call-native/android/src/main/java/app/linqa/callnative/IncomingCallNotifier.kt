package app.linqa.callnative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person

/**
 * Full-screen incoming-call notification (Android's call UI for apps that
 * aren't the phone app). Works with the app killed: it's shown straight from
 * the FCM service, no JS needed.
 *
 * Answer / tap open the app with  linqacall://answer?callId=…  (or ://open),
 * which CallKitBridge picks up through Linking.
 */
object IncomingCallNotifier {
  const val CHANNEL_RING = "linqa_calls_ring"
  const val CHANNEL_ONGOING = "linqa_calls_ongoing"
  private const val RING_TIMEOUT_MS = 45_000L

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL_RING) == null) {
      val ch = NotificationChannel(CHANNEL_RING, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Rings when someone calls you on Linqa"
        setSound(
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        )
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 800, 600, 800)
        lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
      }
      nm.createNotificationChannel(ch)
    }
    if (nm.getNotificationChannel(CHANNEL_ONGOING) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ONGOING, "Ongoing calls", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while you're on a Linqa call"
          setSound(null, null)
        }
      )
    }
  }

  fun show(ctx: Context, callId: String, video: Boolean) {
    ensureChannels(ctx)
    val caller = Person.Builder().setName("Linqa").setImportant(true).build()
    val answer = activityIntent(ctx, "answer", callId, 1)
    val open = activityIntent(ctx, "open", callId, 2)
    val decline = PendingIntent.getBroadcast(
      ctx, callId.hashCode() * 31 + 3,
      Intent(ctx, CallActionReceiver::class.java).setAction(CallActionReceiver.DECLINE).putExtra("callId", callId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val n = NotificationCompat.Builder(ctx, CHANNEL_RING)
      .setSmallIcon(ctx.applicationInfo.icon)
      .setContentTitle(if (video) "Incoming video call" else "Incoming call")
      .setContentText("Linqa")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(true)
      .setTimeoutAfter(RING_TIMEOUT_MS)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(video))
      .build()

    try {
      NotificationManagerCompat.from(ctx).notify(tag(callId), 1, n)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS not granted. The in-app ring still works when open.
    }
  }

  fun cancel(ctx: Context, callId: String) {
    NotificationManagerCompat.from(ctx).cancel(tag(callId), 1)
  }

  private fun tag(callId: String) = "linqa-call-$callId"

  /** Explicit intent to the launcher activity carrying a linqacall:// URL. */
  fun activityIntent(ctx: Context, action: String, callId: String, salt: Int): PendingIntent {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    val component: ComponentName? = launch?.component
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("linqacall://$action?callId=${Uri.encode(callId)}")).apply {
      if (component != null) setComponent(component) else setPackage(ctx.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(
      ctx, callId.hashCode() * 31 + salt, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
