package app.linqa.calls

import android.graphics.Bitmap
import android.graphics.Matrix
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.Segmenter
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import org.webrtc.JavaI420Buffer
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Background blur for the outgoing camera track.
 * Runs on the camera thread. Everything stays on the device.
 *
 * Pipeline: I420 -> upright ARGB (long edge capped at MAX_EDGE) -> ML Kit selfie mask
 * -> cheap downscale blur of the background -> blend -> I420 (rotation 0).
 *
 * Ownership (see react-native-webrtc VideoEffectProcessor): return null to pass the
 * input through untouched. Returning the input frame itself would release it twice.
 */
class LinqaBlurProcessor : VideoFrameProcessor {
    companion object {
        private const val MAX_EDGE = 640
        private const val BLUR_DOWNSCALE = 14
        private const val MASK_EVERY_N_FRAMES = 2
        private const val SEGMENT_TIMEOUT_MS = 60L
    }

    private val segmenter: Segmenter = Segmentation.getClient(
        SelfieSegmenterOptions.Builder()
            .setDetectorMode(SelfieSegmenterOptions.STREAM_MODE)
            .enableRawSizeMask()
            .build()
    )

    private var frameCount = 0
    private var lastMask: FloatArray? = null
    private var lastMaskW = 0
    private var lastMaskH = 0

    private var rgb = IntArray(0)
    private var bgPixels = IntArray(0)

    override fun process(frame: VideoFrame, textureHelper: SurfaceTextureHelper): VideoFrame? {
        val i420 = frame.buffer.toI420() ?: return null
        try {
            // 1. YUV -> ARGB at reduced size.
            val srcW = i420.width
            val srcH = i420.height
            val scale = MAX_EDGE.toFloat() / max(srcW, srcH)
            val w = if (scale < 1f) (srcW * scale).roundToInt() and 1.inv() else srcW and 1.inv()
            val h = if (scale < 1f) (srcH * scale).roundToInt() and 1.inv() else srcH and 1.inv()
            val small = i420ToBitmap(i420, w, h)

            // 2. Make it upright so the person faces the right way for the model.
            val upright = if (frame.rotation % 360 != 0) {
                val m = Matrix().apply { postRotate(frame.rotation.toFloat()) }
                Bitmap.createBitmap(small, 0, 0, w, h, m, true).also { small.recycle() }
            } else small
            val ow = upright.width
            val oh = upright.height

            // 3. Person mask (reuse every other frame to save battery).
            frameCount++
            if (lastMask == null || frameCount % MASK_EVERY_N_FRAMES == 0 || lastMaskW != ow || lastMaskH != oh) {
                segment(upright)?.let { (mask, mw, mh) ->
                    lastMask = resizeMask(mask, mw, mh, ow, oh)
                    lastMaskW = ow
                    lastMaskH = oh
                }
            }
            val mask = lastMask ?: return null.also { upright.recycle() }

            // 4. Blurred background: shrink hard, then scale back up with filtering. Twice.
            val tiny = Bitmap.createScaledBitmap(upright, max(1, ow / BLUR_DOWNSCALE), max(1, oh / BLUR_DOWNSCALE), true)
            val mid = Bitmap.createScaledBitmap(tiny, max(1, ow / 4), max(1, oh / 4), true)
            val bg = Bitmap.createScaledBitmap(mid, ow, oh, true)
            tiny.recycle(); mid.recycle()

            // 5. Blend.
            val n = ow * oh
            if (rgb.size != n) { rgb = IntArray(n); bgPixels = IntArray(n) }
            upright.getPixels(rgb, 0, ow, 0, 0, ow, oh)
            bg.getPixels(bgPixels, 0, ow, 0, 0, ow, oh)
            upright.recycle(); bg.recycle()
            for (i in 0 until n) {
                val a = mask[i]
                if (a >= 0.98f) continue
                val f = rgb[i]; val b = bgPixels[i]
                val r = (((f shr 16) and 0xFF) * a + ((b shr 16) and 0xFF) * (1 - a)).toInt()
                val g = (((f shr 8) and 0xFF) * a + ((b shr 8) and 0xFF) * (1 - a)).toInt()
                val bl = ((f and 0xFF) * a + (b and 0xFF) * (1 - a)).toInt()
                rgb[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or bl
            }

            // 6. Back to I420, already upright.
            val out = argbToI420(rgb, ow, oh)
            return VideoFrame(out, 0, frame.timestampNs)
        } catch (t: Throwable) {
            return null
        } finally {
            i420.release()
        }
    }

    private fun segment(bmp: Bitmap): Triple<FloatArray, Int, Int>? = try {
        val result = Tasks.await(segmenter.process(InputImage.fromBitmap(bmp, 0)), SEGMENT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        val buf = result.buffer.order(ByteOrder.nativeOrder())
        buf.rewind()
        val arr = FloatArray(result.width * result.height)
        buf.asFloatBuffer().get(arr)
        Triple(arr, result.width, result.height)
    } catch (_: Exception) {
        null
    }

    private fun resizeMask(m: FloatArray, mw: Int, mh: Int, w: Int, h: Int): FloatArray {
        if (mw == w && mh == h) return m
        val out = FloatArray(w * h)
        for (y in 0 until h) {
            val sy = (y * mh / h).coerceAtMost(mh - 1)
            for (x in 0 until w) {
                val sx = (x * mw / w).coerceAtMost(mw - 1)
                out[y * w + x] = m[sy * mw + sx]
            }
        }
        return out
    }

    /** Nearest-neighbour scale + BT.601 full-range YUV -> ARGB. */
    private fun i420ToBitmap(b: VideoFrame.I420Buffer, w: Int, h: Int): Bitmap {
        val sw = b.width; val sh = b.height
        val yP = b.dataY; val uP = b.dataU; val vP = b.dataV
        val ys = b.strideY; val us = b.strideU; val vs = b.strideV
        if (rgb.size != w * h) { rgb = IntArray(w * h); bgPixels = IntArray(w * h) }
        for (y in 0 until h) {
            val sy = y * sh / h
            for (x in 0 until w) {
                val sx = x * sw / w
                val Y = (yP.get(sy * ys + sx).toInt() and 0xFF)
                val U = (uP.get((sy shr 1) * us + (sx shr 1)).toInt() and 0xFF) - 128
                val V = (vP.get((sy shr 1) * vs + (sx shr 1)).toInt() and 0xFF) - 128
                val r = (Y + 1.402f * V).toInt().coerceIn(0, 255)
                val g = (Y - 0.344f * U - 0.714f * V).toInt().coerceIn(0, 255)
                val bl = (Y + 1.772f * U).toInt().coerceIn(0, 255)
                rgb[y * w + x] = (0xFF shl 24) or (r shl 16) or (g shl 8) or bl
            }
        }
        return Bitmap.createBitmap(rgb, w, h, Bitmap.Config.ARGB_8888)
    }

    private fun argbToI420(px: IntArray, w: Int, h: Int): JavaI420Buffer {
        val out = JavaI420Buffer.allocate(w, h)
        val yB = out.dataY; val uB = out.dataU; val vB = out.dataV
        val ys = out.strideY; val us = out.strideU; val vs = out.strideV
        for (y in 0 until h) {
            for (x in 0 until w) {
                val c = px[y * w + x]
                val r = (c shr 16) and 0xFF; val g = (c shr 8) and 0xFF; val b = c and 0xFF
                yB.put(y * ys + x, (0.299f * r + 0.587f * g + 0.114f * b).toInt().coerceIn(0, 255).toByte())
                if (y and 1 == 0 && x and 1 == 0) {
                    val u = (-0.169f * r - 0.331f * g + 0.5f * b + 128).toInt().coerceIn(0, 255)
                    val v = (0.5f * r - 0.419f * g - 0.081f * b + 128).toInt().coerceIn(0, 255)
                    uB.put((y shr 1) * us + (x shr 1), u.toByte())
                    vB.put((y shr 1) * vs + (x shr 1), v.toByte())
                }
            }
        }
        return out
    }
}
