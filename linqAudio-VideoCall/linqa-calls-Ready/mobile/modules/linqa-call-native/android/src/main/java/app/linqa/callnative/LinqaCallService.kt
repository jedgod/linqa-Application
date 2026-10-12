package app.linqa.callnative

import android.Manifest
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps a call running when Linqa goes to the background. Android 14+ only
 * lets an app keep using the mic/camera in the background from a foreground
 * service of the matching type.
 */
class LinqaCallService : Service() {
  companion object {
    fun start(ctx: Context, callId: String, video: Boolean) {
      val i = Intent(ctx, LinqaCallService::class.java).putExtra("callId", callId).putExtra("video", video)
      ContextCompat.startForegroundService(ctx, i)
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, LinqaCallService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val callId = intent?.getStringExtra("callId") ?: "call"
    val video = intent?.getBooleanExtra("video", false) ?: false
    IncomingCallNotifier.ensureChannels(this)

    val end = PendingIntent.getBroadcast(
      this, 7,
      Intent(this, CallActionReceiver::class.java).setAction(CallActionReceiver.END).putExtra("callId", callId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification = NotificationCompat.Builder(this, IncomingCallNotifier.CHANNEL_ONGOING)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(if (video) "Linqa video call" else "Linqa call")
      .setContentText("Tap to return to the call")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setContentIntent(IncomingCallNotifier.activityIntent(this, "open", callId, 9))
      .addAction(0, "End", end)
      .build()

    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (granted(Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (video && granted(Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    }
    try {
      ServiceCompat.startForeground(this, 4242, notification, types)
    } catch (e: Exception) {
      stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED
}
