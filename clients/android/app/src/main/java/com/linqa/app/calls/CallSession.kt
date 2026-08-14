package com.linqa.app.calls

import android.content.Context
import android.util.Base64
import com.linqa.app.auth.SessionStore
import com.linqa.app.crypto.SignalingCrypto
import com.linqa.app.network.CallsApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.PeerConnection
import org.webrtc.SessionDescription

enum class CallState { IDLE, OUTGOING_RINGING, CONNECTING, ACTIVE, ENDED, FAILED }

/**
 * Orchestrates a real 1:1 outgoing call end to end: `POST /v1/calls` →
 * fetch TURN credentials → build the peer connection → open the signaling
 * WebSocket → create+send an encrypted OFFER → receive an encrypted
 * ANSWER → exchange encrypted ICE candidates → connected. Incoming calls
 * are explicitly out of scope for this pass (see plan) — this class only
 * places calls, it doesn't answer them.
 */
class CallSession(
    private val context: Context,
    private val eglBase: EglBase,
    private val callsApi: CallsApi,
    private val signalingBaseUrl: String,
    private val sessions: SessionStore,
    private val signalingCrypto: SignalingCrypto,
    private val onStateChange: (CallState) -> Unit,
    private val onRemoteTrack: (RemoteTrackEvent) -> Unit,
) {
    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    private var webRtc: WebRtcClient? = null
    private var signaling: SignalingClient? = null
    private var callId: String? = null
    private var recipientDeviceId: String? = null
    private var recipientPublicKey: ByteArray? = null

    var state: CallState = CallState.IDLE
        private set(value) {
            field = value
            onStateChange(value)
        }

    fun webRtcClientOrNull(): WebRtcClient? = webRtc

    fun startOutgoingCall(
        recipientUserId: String,
        recipientDeviceId: String,
        recipientPublicKey: ByteArray,
        video: Boolean,
        privacyMode: String = "STANDARD",
    ) {
        this.recipientDeviceId = recipientDeviceId
        this.recipientPublicKey = recipientPublicKey
        state = CallState.OUTGOING_RINGING

        scope.launch {
            try {
                val created = callsApi.createCall(recipientUserId, recipientDeviceId, video, privacyMode)
                callId = created.callId
                val turn = callsApi.turnCredentials()

                val webRtcClient = WebRtcClient(
                    context = context,
                    eglBase = eglBase,
                    turn = turn,
                    relayOnly = privacyMode == "RELAY_ONLY",
                    onIceCandidate = ::onLocalIceCandidate,
                    onRemoteTrack = onRemoteTrack,
                    onConnectionStateChange = ::onPeerConnectionStateChange,
                )
                webRtc = webRtcClient
                webRtcClient.addLocalAudio()
                if (video) webRtcClient.addLocalVideo(context)

                val signalingClient = SignalingClient(signalingBaseUrl, sessions)
                signaling = signalingClient
                signalingClient.connect(
                    callId = created.callId,
                    onReady = { scope.launch { sendOffer(webRtcClient, signalingClient, created.callId) } },
                    onEvent = { event -> scope.launch { handleSignalingEvent(webRtcClient, event) } },
                    onClosed = { _, _ -> if (state != CallState.ENDED) state = CallState.FAILED },
                )
            } catch (e: Exception) {
                state = CallState.FAILED
            }
        }
    }

    fun setMuted(muted: Boolean) = webRtc?.setMuted(muted)

    fun switchCamera() = webRtc?.switchCamera()

    fun endCall() {
        scope.launch {
            callId?.let { runCatching { callsApi.endCall(it) } }
            cleanup(CallState.ENDED)
        }
    }

    private suspend fun sendOffer(webRtcClient: WebRtcClient, signalingClient: SignalingClient, callId: String) {
        val offer = webRtcClient.createOffer()
        webRtcClient.setLocalDescription(offer)
        val payload = JSONObject()
            .put("type", offer.type.canonicalForm())
            .put("sdp", offer.description)
        sendEncrypted(signalingClient, callId, "OFFER", payload)
    }

    private fun onLocalIceCandidate(candidate: IceCandidate) {
        val callId = this.callId ?: return
        val signalingClient = this.signaling ?: return
        val payload = JSONObject()
            .put("candidate", candidate.sdp)
            .put("sdpMid", candidate.sdpMid)
            .put("sdpMLineIndex", candidate.sdpMLineIndex)
        scope.launch { sendEncrypted(signalingClient, callId, "ICE_CANDIDATE", payload) }
    }

    private fun sendEncrypted(
        signalingClient: SignalingClient,
        callId: String,
        eventType: String,
        payload: JSONObject,
    ) {
        val recipientDeviceId = this.recipientDeviceId ?: return
        val recipientPublicKey = this.recipientPublicKey ?: return
        val myDeviceId = sessions.current()?.deviceId ?: return

        val sequence = signalingClient.reserveSequence()
        val ciphertext = signalingCrypto.encrypt(callId, myDeviceId, sequence, recipientPublicKey, payload)
        signalingClient.send(callId, recipientDeviceId, eventType, sequence, ciphertext)
    }

    private suspend fun handleSignalingEvent(webRtcClient: WebRtcClient, event: SignalingEvent) {
        val callId = this.callId ?: return
        val recipientPublicKey = this.recipientPublicKey ?: return
        val ciphertext = Base64.decode(event.ciphertextBase64, Base64.NO_WRAP)
        val payload = try {
            signalingCrypto.decrypt(callId, event.senderDeviceId, event.sequence, recipientPublicKey, ciphertext)
        } catch (e: Exception) {
            // Never acknowledge or act on a signaling event that fails to
            // decrypt/authenticate — same principle as the message relay's
            // "failed decryption is not acknowledged" rule.
            return
        }

        when (event.eventType) {
            "ANSWER" -> {
                webRtcClient.setRemoteDescription(
                    SessionDescription(SessionDescription.Type.ANSWER, payload.getString("sdp")),
                )
                state = CallState.CONNECTING
            }
            "ICE_CANDIDATE" -> {
                webRtcClient.addIceCandidate(
                    IceCandidate(
                        payload.getString("sdpMid"),
                        payload.getInt("sdpMLineIndex"),
                        payload.getString("candidate"),
                    ),
                )
            }
            "CALL_REJECTED", "CALL_ENDED" -> cleanup(CallState.ENDED)
        }
    }

    private fun onPeerConnectionStateChange(newState: PeerConnection.PeerConnectionState) {
        state = when (newState) {
            PeerConnection.PeerConnectionState.CONNECTED -> CallState.ACTIVE
            PeerConnection.PeerConnectionState.FAILED -> CallState.FAILED
            PeerConnection.PeerConnectionState.DISCONNECTED,
            PeerConnection.PeerConnectionState.CLOSED -> CallState.ENDED
            else -> state
        }
    }

    private fun cleanup(finalState: CallState) {
        signaling?.close()
        webRtc?.close()
        state = finalState
    }
}
