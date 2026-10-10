package com.linqa.mobile.recording

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import org.webrtc.audio.JavaAudioDeviceModule
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Records this phone's own microphone during a call and transcribes it on the device (Vosk, offline).
 *
 * The samples come from the same audio device WebRTC already captures with, so no second microphone session is opened and
 * echo cancellation has already been applied. Only the local microphone is available there; the other person's voice is not
 * tapped. Output is a 16 kHz mono 16-bit WAV file, and each finished sentence is reported through [onSegment].
 */
object CallRecorder : JavaAudioDeviceModule.SamplesReadyCallback {
  private const val TAG = "CallRecorder"
  private const val TARGET_RATE = 16000
  private const val MODEL_DIR = "vosk-model-en"

  private val worker = Executors.newSingleThreadExecutor()
  private val prepareWorker = Executors.newSingleThreadExecutor()
  @Volatile var model: Model? = null
  @Volatile private var active = false
  @Volatile var muted = false

  private var file: RandomAccessFile? = null
  private var recognizer: Recognizer? = null
  private var samplesWritten = 0L
  private var resamplePos = 0.0
  private var lastSegmentEndMs = 0L
  var onSegment: ((text: String, startMs: Long, endMs: Long) -> Unit)? = null

  /** Unpacks the speech model on first use and loads it. Safe to call repeatedly; calls run one after another. */
  fun prepare(context: Context, done: (Throwable?) -> Unit) {
    prepareWorker.execute {
      if (model != null) { done(null); return@execute }
      try {
        val target = File(context.filesDir, MODEL_DIR)
        if (!File(target, ".ready").exists()) {
          target.deleteRecursively()
          copyAsset(context, MODEL_DIR, target)
          File(target, ".ready").writeText("ok")
        }
        LibVosk.setLogLevel(LogLevel.WARNINGS)
        model = Model(target.absolutePath)
        done(null)
      } catch (t: Throwable) {
        Log.e(TAG, "speech model failed to load", t)
        done(t)
      }
    }
  }

  private fun copyAsset(context: Context, assetPath: String, target: File) {
    val children = context.assets.list(assetPath) ?: emptyArray()
    if (children.isEmpty()) {
      target.parentFile?.mkdirs()
      context.assets.open(assetPath).use { input -> target.outputStream().use { input.copyTo(it) } }
    } else {
      target.mkdirs()
      for (child in children) copyAsset(context, "$assetPath/$child", File(target, child))
    }
  }

  fun start(path: String) {
    val loaded = model ?: throw IllegalStateException("The speech model is not ready yet.")
    synchronized(this) {
      if (active) throw IllegalStateException("Already recording.")
      val target = File(path)
      target.parentFile?.mkdirs()
      val out = RandomAccessFile(target, "rw")
      out.setLength(0)
      out.write(ByteArray(44))
      file = out
      recognizer = Recognizer(loaded, TARGET_RATE.toFloat()).also { it.setWords(true) }
      samplesWritten = 0
      resamplePos = 0.0
      lastSegmentEndMs = 0
      active = true
    }
  }

  /** Stops, finishes the WAV header, and returns the recording length in milliseconds. */
  fun stop(): Long {
    synchronized(this) {
      if (!active) return 0L
      active = false
    }
    // Everything already queued is processed first; then the last sentence is flushed and the file closed.
    val latch = CountDownLatch(1)
    var durationMs = 0L
    worker.execute {
      try {
        val rec = recognizer
        val out = file
        recognizer = null
        file = null
        if (rec != null) { report(rec.finalResult); rec.close() }
        if (out != null) {
          durationMs = samplesWritten * 1000 / TARGET_RATE
          out.seek(0)
          out.write(wavHeader(samplesWritten * 2))
          out.close()
        }
      } catch (t: Throwable) {
        Log.e(TAG, "stop failed", t)
      } finally {
        latch.countDown()
      }
    }
    latch.await(20, TimeUnit.SECONDS)
    return durationMs
  }

  override fun onWebRtcAudioRecordSamplesReady(samples: JavaAudioDeviceModule.AudioSamples) {
    if (!active) return
    val data = samples.data.copyOf()
    val rate = samples.sampleRate
    val channels = samples.channelCount
    val silent = muted
    worker.execute { process(data, rate, channels, silent) }
  }

  private fun process(data: ByteArray, rate: Int, channels: Int, silent: Boolean) {
    val out = file ?: return
    val rec = recognizer ?: return
    val frames = data.size / 2 / channels
    if (frames <= 0) return
    val buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
    val mono = ShortArray(frames)
    for (i in 0 until frames) {
      var sum = 0
      for (c in 0 until channels) sum += buffer.getShort((i * channels + c) * 2).toInt()
      mono[i] = if (silent) 0 else (sum / channels).toShort()
    }
    val step = rate.toDouble() / TARGET_RATE
    val resampled = ShortArray(((frames - resamplePos) / step).toInt() + 2)
    var n = 0
    var p = resamplePos
    while (p < frames) {
      val i = p.toInt()
      val a = mono[i].toInt()
      val b = if (i + 1 < frames) mono[i + 1].toInt() else a
      resampled[n++] = (a + (b - a) * (p - i)).toInt().toShort()
      p += step
    }
    resamplePos = p - frames
    val bytes = ByteBuffer.allocate(n * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until n) bytes.putShort(resampled[i])
    out.write(bytes.array())
    samplesWritten += n
    if (rec.acceptWaveForm(resampled, n)) report(rec.result)
  }

  private fun report(json: String) {
    try {
      val parsed = JSONObject(json)
      val text = parsed.optString("text").trim()
      if (text.isEmpty()) return
      val words = parsed.optJSONArray("result")
      val hasWords = words != null && words.length() > 0
      val startMs = if (hasWords) (words!!.getJSONObject(0).optDouble("start") * 1000).toLong() else lastSegmentEndMs
      val endMs = if (hasWords) (words!!.getJSONObject(words.length() - 1).optDouble("end") * 1000).toLong() else samplesWritten * 1000 / TARGET_RATE
      lastSegmentEndMs = endMs
      onSegment?.invoke(text, startMs, endMs)
    } catch (t: Throwable) {
      Log.w(TAG, "unreadable recognizer result", t)
    }
  }

  private fun wavHeader(dataBytes: Long): ByteArray {
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray()).putInt((36 + dataBytes).toInt()).put("WAVE".toByteArray())
    header.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(TARGET_RATE).putInt(TARGET_RATE * 2).putShort(2).putShort(16)
    header.put("data".toByteArray()).putInt(dataBytes.toInt())
    return header.array()
  }
}

/**
 * Speaks-to-text for Linqa AI's Voice mode: opens the microphone, recognises on the device with the same offline model, and
 * reports partial and final text. Not used during a call (the call already owns the microphone).
 */
object Dictation {
  private const val TAG = "Dictation"
  @Volatile private var running = false
  private var thread: Thread? = null
  var onText: ((text: String, final: Boolean) -> Unit)? = null

  @android.annotation.SuppressLint("MissingPermission")
  fun start(context: Context, model: Model) {
    if (running) return
    running = true
    thread = Thread {
      var record: android.media.AudioRecord? = null
      var rec: Recognizer? = null
      try {
        val rate = 16000
        val minBuffer = android.media.AudioRecord.getMinBufferSize(rate, android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT)
        record = android.media.AudioRecord(android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuffer, 8192))
        rec = Recognizer(model, rate.toFloat())
        record.startRecording()
        val buffer = ShortArray(2048)
        var committed = ""
        while (running) {
          val read = record.read(buffer, 0, buffer.size)
          if (read <= 0) continue
          if (rec.acceptWaveForm(buffer, read)) {
            val text = JSONObject(rec.result).optString("text").trim()
            if (text.isNotEmpty()) { committed = (committed + " " + text).trim(); onText?.invoke(committed, false) }
          } else {
            val partial = JSONObject(rec.partialResult).optString("partial").trim()
            if (partial.isNotEmpty()) onText?.invoke((committed + " " + partial).trim(), false)
          }
        }
        val last = JSONObject(rec.finalResult).optString("text").trim()
        if (last.isNotEmpty()) committed = (committed + " " + last).trim()
        onText?.invoke(committed, true)
      } catch (t: Throwable) {
        Log.e(TAG, "dictation failed", t)
        onText?.invoke("", true)
      } finally {
        try { record?.stop() } catch (_: Throwable) {}
        try { record?.release() } catch (_: Throwable) {}
        try { rec?.close() } catch (_: Throwable) {}
        running = false
      }
    }.also { it.start() }
  }

  fun stop() { running = false }
  fun isRunning() = running
}
