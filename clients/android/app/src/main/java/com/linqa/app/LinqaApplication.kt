package com.linqa.app

import android.app.Application
import com.linqa.app.calls.WebRtcClient
import com.linqa.app.crypto.DeviceIdentity
import com.linqa.app.crypto.NativeCore

/**
 * Application entry point.
 *
 * Later this will also set up background sync / push handling.
 *
 * WebRTC global init is required once per process before any
 * PeerConnectionFactory is created — see `calls/CallSession.kt`.
 */
class LinqaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        WebRtcClient.globalInitialize(this)
        NativeCore.initialize(this, DeviceIdentity(this))
    }
}
