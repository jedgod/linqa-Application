package com.linqa.mobile.recording

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager

class LinqaCallRecorderModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "LinqaCallRecorder"

  @ReactMethod
  fun prepare(promise: Promise) {
    CallRecorder.prepare(context) { error -> if (error == null) promise.resolve(true) else promise.reject("SPEECH_MODEL", error.message, error) }
  }

  @ReactMethod
  fun start(path: String, promise: Promise) {
    try {
      CallRecorder.onSegment = { text, startMs, endMs ->
        val body = Arguments.createMap().apply { putString("text", text); putDouble("startMs", startMs.toDouble()); putDouble("endMs", endMs.toDouble()) }
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("linqaTranscript", body)
      }
      CallRecorder.start(path.removePrefix("file://"))
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.reject("RECORDER_START", t.message, t)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    Thread {
      try {
        val ms = CallRecorder.stop()
        promise.resolve(Arguments.createMap().apply { putDouble("durationMs", ms.toDouble()) })
      } catch (t: Throwable) {
        promise.reject("RECORDER_STOP", t.message, t)
      }
    }.start()
  }

  @ReactMethod
  fun startDictation(promise: Promise) {
    val loaded = CallRecorder.model
    if (loaded == null) { promise.reject("SPEECH_MODEL", "The speech model is not ready yet."); return }
    Dictation.onText = { text, final ->
      val body = Arguments.createMap().apply { putString("text", text); putBoolean("final", final) }
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("linqaDictation", body)
    }
    Dictation.start(context, loaded)
    promise.resolve(true)
  }

  @ReactMethod
  fun stopDictation() { Dictation.stop() }

  @ReactMethod
  fun setMuted(muted: Boolean) { CallRecorder.muted = muted }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}

class LinqaCallRecorderPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(LinqaCallRecorderModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
