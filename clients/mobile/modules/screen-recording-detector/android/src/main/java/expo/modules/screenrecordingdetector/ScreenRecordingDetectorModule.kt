package expo.modules.screenrecordingdetector

import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.function.Consumer

class ScreenRecordingDetectorModule : Module() {
  @Volatile private var recording = false
  private var callback: Consumer<Int>? = null

  override fun definition() = ModuleDefinition {
    Name("ScreenRecordingDetector")

    Events("onChange")

    Constants("isSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM))

    Function("isCaptured") {
      register()
      recording
    }

    OnStartObserving { register() }

    OnStopObserving { unregister() }

    OnActivityDestroys { unregister() }
  }

  @Synchronized
  private fun register() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM || callback != null) return
    val activity = appContext.currentActivity ?: return
    val cb = Consumer<Int> { state ->
      recording = state == WindowManager.SCREEN_RECORDING_STATE_VISIBLE
      sendEvent("onChange", mapOf("isCaptured" to recording))
    }
    // Returns the current state immediately, then calls cb on every change.
    val initial = activity.windowManager.addScreenRecordingCallback(activity.mainExecutor, cb)
    recording = initial == WindowManager.SCREEN_RECORDING_STATE_VISIBLE
    callback = cb
  }

  @Synchronized
  private fun unregister() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return
    val cb = callback ?: return
    appContext.currentActivity?.windowManager?.removeScreenRecordingCallback(cb)
    callback = null
  }
}
