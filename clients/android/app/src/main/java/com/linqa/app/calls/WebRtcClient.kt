package com.linqa.app.calls

import android.content.Context
import com.linqa.app.network.TurnCredentials
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

data class RemoteTrackEvent(val track: MediaStreamTrack)

/**
 * Real WebRTC peer connection wrapper. Mirrors
 * `clients/web/src/calls/ProductionCallController.ts`'s configuration
 * (`bundlePolicy=MAX_BUNDLE`, `rtcpMuxPolicy=REQUIRE`,
 * `iceTransportPolicy=RELAY` when `privacyMode=RELAY_ONLY`) against the
 * real `/v1/calls/turn-credentials` HMAC TURN scheme. Bridges WebRTC's
 * callback-based SDP APIs into coroutines; ICE candidates and connection
 * state are delivered via the constructor's `onIceCandidate`/`onStateChange`
 * callbacks since they arrive as an ongoing stream, not a single result.
 */
class WebRtcClient(
    context: Context,
    private val eglBase: EglBase,
    turn: TurnCredentials,
    relayOnly: Boolean,
    private val onIceCandidate: (IceCandidate) -> Unit,
    private val onRemoteTrack: (RemoteTrackEvent) -> Unit,
    private val onConnectionStateChange: (PeerConnection.PeerConnectionState) -> Unit,
) {
    private val factory: PeerConnectionFactory
    private val peerConnection: PeerConnection
    private var videoCapturer: CameraVideoCapturer? = null
    private var localAudioTrack: AudioTrack? = null
    private var localVideoTrack: VideoTrack? = null

    init {
        val encoderFactory = DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true)
        val decoderFactory = DefaultVideoDecoderFactory(eglBase.eglBaseContext)
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()

        val iceServer = PeerConnection.IceServer.builder(turn.urls)
            .setUsername(turn.username)
            .setPassword(turn.credential)
            .createIceServer()

        val rtcConfig = PeerConnection.RTCConfiguration(listOf(iceServer)).apply {
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            iceTransportsType = if (relayOnly) {
                PeerConnection.IceTransportsType.RELAY
            } else {
                PeerConnection.IceTransportsType.ALL
            }
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        peerConnection = factory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) = onIceCandidate.invoke(candidate)
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) =
                onConnectionStateChange.invoke(newState)
            override fun onTrack(transceiver: org.webrtc.RtpTransceiver) {
                onRemoteTrack(RemoteTrackEvent(transceiver.receiver.track() ?: return))
            }
            override fun onAddStream(stream: org.webrtc.MediaStream) {}
            override fun onRemoveStream(stream: org.webrtc.MediaStream) {}
            override fun onDataChannel(channel: org.webrtc.DataChannel) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
            override fun onRenegotiationNeeded() {}
            override fun onSignalingChange(state: PeerConnection.SignalingState) {}
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out org.webrtc.MediaStream>) {}
        }) ?: error("failed to create peer connection")
    }

    fun addLocalAudio() {
        val audioSource: AudioSource = factory.createAudioSource(MediaConstraints())
        val track = factory.createAudioTrack("linqa-audio-0", audioSource)
        localAudioTrack = track
        peerConnection.addTrack(track)
    }

    fun addLocalVideo(context: Context, front: Boolean = true) {
        val enumerator = Camera2Enumerator(context)
        val deviceName = enumerator.deviceNames.firstOrNull {
            if (front) enumerator.isFrontFacing(it) else enumerator.isBackFacing(it)
        } ?: enumerator.deviceNames.firstOrNull() ?: return

        val capturer = enumerator.createCapturer(deviceName, null) ?: return
        val videoSource: VideoSource = factory.createVideoSource(capturer.isScreencast)
        val surfaceHelper = SurfaceTextureHelper.create("linqa-capture-thread", eglBase.eglBaseContext)
        capturer.initialize(surfaceHelper, context, videoSource.capturerObserver)
        capturer.startCapture(1280, 720, 30)

        val track = factory.createVideoTrack("linqa-video-0", videoSource)
        videoCapturer = capturer
        localVideoTrack = track
        peerConnection.addTrack(track)
    }

    fun localVideoTrackOrNull(): VideoTrack? = localVideoTrack

    fun setMuted(muted: Boolean) {
        localAudioTrack?.setEnabled(!muted)
    }

    fun switchCamera() {
        videoCapturer?.switchCamera(null)
    }

    suspend fun createOffer(): SessionDescription = suspendCancellableCoroutine { continuation ->
        peerConnection.createOffer(sdpObserver(continuation), MediaConstraints())
    }

    suspend fun createAnswer(): SessionDescription = suspendCancellableCoroutine { continuation ->
        peerConnection.createAnswer(sdpObserver(continuation), MediaConstraints())
    }

    suspend fun setLocalDescription(description: SessionDescription): Unit =
        suspendCancellableCoroutine { continuation ->
            peerConnection.setLocalDescription(setObserver(continuation), description)
        }

    suspend fun setRemoteDescription(description: SessionDescription): Unit =
        suspendCancellableCoroutine { continuation ->
            peerConnection.setRemoteDescription(setObserver(continuation), description)
        }

    fun addIceCandidate(candidate: IceCandidate) {
        peerConnection.addIceCandidate(candidate)
    }

    fun close() {
        videoCapturer?.stopCapture()
        videoCapturer?.dispose()
        peerConnection.close()
        peerConnection.dispose()
        factory.dispose()
    }

    private fun sdpObserver(
        continuation: kotlin.coroutines.Continuation<SessionDescription>,
    ) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = continuation.resume(description)
        override fun onCreateFailure(error: String) =
            continuation.resumeWithException(IllegalStateException(error))
        override fun onSetSuccess() {}
        override fun onSetFailure(error: String) {}
    }

    private fun setObserver(
        continuation: kotlin.coroutines.Continuation<Unit>,
    ) = object : SdpObserver {
        override fun onSetSuccess() = continuation.resume(Unit)
        override fun onSetFailure(error: String) =
            continuation.resumeWithException(IllegalStateException(error))
        override fun onCreateSuccess(description: SessionDescription) {}
        override fun onCreateFailure(error: String) {}
    }

    companion object {
        @Volatile private var initialized = false

        fun globalInitialize(context: Context) {
            if (initialized) return
            synchronized(this) {
                if (initialized) return
                PeerConnectionFactory.initialize(
                    PeerConnectionFactory.InitializationOptions.builder(context)
                        .createInitializationOptions(),
                )
                initialized = true
            }
        }
    }
}
