package app.linqa.calls

import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.uimanager.ViewManager
import com.oney.WebRTCModule.videoEffects.ProcessorProvider
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessorFactoryInterface

/** Registers the "linqa-blur" effect and tells JS whether blur is available. */
class LinqaVideoEffectsModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    init {
        ProcessorProvider.addProcessor("linqa-blur", object : VideoFrameProcessorFactoryInterface {
            override fun build(): VideoFrameProcessor = LinqaBlurProcessor()
        })
    }

    override fun getName() = "LinqaVideoEffects"

    override fun getConstants(): Map<String, Any> =
        mapOf("blurSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N))
}

/** Add `LinqaVideoEffectsPackage()` to getPackages() in MainApplication. */
class LinqaVideoEffectsPackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =
        listOf(LinqaVideoEffectsModule(ctx))

    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
