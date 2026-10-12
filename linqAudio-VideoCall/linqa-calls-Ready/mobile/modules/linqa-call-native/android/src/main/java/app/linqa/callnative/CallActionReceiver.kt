package app.linqa.callnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles Decline on the incoming-call notification and End on the ongoing
 * one. Declines are remembered so JS can tell the server as soon as it runs
 * (the server also stops ringing on its own after 45 seconds).
 */
class CallActionReceiver : BroadcastReceiver() {
  companion object {
    const val DECLINE = "app.linqa.callnative.DECLINE"
    const val END = "app.linqa.callnative.END"
    private const val PREFS = "linqa_call_native"
    private const val KEY_DECLINED = "declined"

    fun takeDeclined(ctx: Context): List<String> {
      val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val list = p.getStringSet(KEY_DECLINED, emptySet())!!.toList()
      p.edit().remove(KEY_DECLINED).apply()
      return list
    }
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    val callId = intent.getStringExtra("callId") ?: return
    when (intent.action) {
      DECLINE -> {
        IncomingCallNotifier.cancel(ctx, callId)
        if (!LinqaCallNativeModule.emitAction("decline", callId)) {
          val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          val set = p.getStringSet(KEY_DECLINED, emptySet())!!.toMutableSet().apply { add(callId) }
          p.edit().putStringSet(KEY_DECLINED, set).apply()
        }
      }
      END -> LinqaCallNativeModule.emitAction("end", callId)
    }
  }
}

object PushTokenStore {
  private const val PREFS = "linqa_call_native"
  fun save(ctx: Context, token: String) =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("fcm", token).apply()
  fun get(ctx: Context): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("fcm", null)
}
