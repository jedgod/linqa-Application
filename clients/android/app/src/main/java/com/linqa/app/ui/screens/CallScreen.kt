package com.linqa.app.ui.screens

import android.content.Context
import android.media.AudioManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CallEnd
import androidx.compose.material.icons.rounded.Cameraswitch
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.linqa.app.calls.CallSession
import com.linqa.app.calls.CallState
import com.linqa.app.calls.RemoteTrackEvent
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaBackground
import com.linqa.app.ui.theme.LinqaPanel
import com.linqa.app.ui.theme.LinqaText
import com.linqa.app.ui.theme.LinqaTextFaint
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

private val WarningAmber = Color(0xFFFFB84D)

@Composable
fun CallScreen(
    session: CallSession,
    eglBase: EglBase,
    peerName: String,
    video: Boolean,
    state: CallState,
    remoteTrack: RemoteTrackEvent?,
    onEnd: () -> Unit,
) {
    val context = LocalContext.current
    var muted by remember { mutableStateOf(false) }
    var speakerOn by remember { mutableStateOf(video) }

    DisposableEffect(Unit) {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val previousMode = audioManager.mode
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        audioManager.isSpeakerphoneOn = speakerOn
        onDispose {
            audioManager.mode = previousMode
            audioManager.isSpeakerphoneOn = false
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(LinqaBackground)) {
        if (video) {
            RemoteVideoSurface(eglBase, remoteTrack, modifier = Modifier.fillMaxSize())
            LocalVideoPreview(
                eglBase = eglBase,
                track = session.webRtcClientOrNull()?.localVideoTrackOrNull(),
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp)
                    .size(width = 110.dp, height = 150.dp)
                    .background(Color(0xFF0B1D2B), RoundedCornerShape(18.dp)),
            )
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(color = Color(0x66061218)),
        )

        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Box(
                    modifier = Modifier
                        .size(78.dp)
                        .background(LinqaPanel, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        peerName.take(2).uppercase(),
                        color = LinqaText,
                        fontWeight = FontWeight.Bold,
                        fontSize = 22.sp,
                    )
                }
                Spacer(Modifier.height(12.dp))
                Text(peerName, color = LinqaText, fontWeight = FontWeight.Bold, fontSize = 24.sp)
                Spacer(Modifier.height(6.dp))
                Box(
                    modifier = Modifier
                        .background(Color(0xFF0F2E3F), RoundedCornerShape(999.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Text(callStateLabel(state), color = callStateColor(state), fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                CallControlButton(
                    icon = if (muted) Icons.Rounded.MicOff else Icons.Rounded.Mic,
                    label = if (muted) "Unmute" else "Mute",
                    active = muted,
                    onClick = {
                        muted = !muted
                        session.setMuted(muted)
                    },
                )
                CallControlButton(
                    icon = Icons.Rounded.VolumeUp,
                    label = "Speaker",
                    active = speakerOn,
                    onClick = {
                        speakerOn = !speakerOn
                        (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager)
                            .isSpeakerphoneOn = speakerOn
                    },
                )
                if (video) {
                    CallControlButton(
                        icon = Icons.Rounded.Cameraswitch,
                        label = "Flip",
                        active = false,
                        onClick = { session.switchCamera() },
                    )
                }
                CallControlButton(
                    icon = Icons.Rounded.CallEnd,
                    label = "End",
                    active = true,
                    activeColor = Color(0xFFE5484D),
                    onClick = {
                        session.endCall()
                        onEnd()
                    },
                )
            }
        }
    }
}

@Composable
private fun CallControlButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean,
    activeColor: Color = LinqaAccent,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(
            onClick = onClick,
            modifier = Modifier
                .size(58.dp)
                .background(if (active) activeColor else Color(0xFF102A3C), CircleShape),
        ) {
            Icon(icon, contentDescription = label, tint = if (active) Color.White else LinqaText)
        }
        Text(label, color = LinqaTextFaint, fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun RemoteVideoSurface(eglBase: EglBase, track: RemoteTrackEvent?, modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            SurfaceViewRenderer(context).apply {
                init(eglBase.eglBaseContext, null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
            }
        },
        update = { renderer ->
            (track?.track as? VideoTrack)?.addSink(renderer)
        },
    )
}

@Composable
private fun LocalVideoPreview(eglBase: EglBase, track: VideoTrack?, modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            SurfaceViewRenderer(context).apply {
                init(eglBase.eglBaseContext, null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setMirror(true)
                setZOrderMediaOverlay(true)
            }
        },
        update = { renderer -> track?.addSink(renderer) },
    )
}

private fun callStateLabel(state: CallState): String = when (state) {
    CallState.IDLE -> "Starting…"
    CallState.OUTGOING_RINGING -> "Calling…"
    CallState.CONNECTING -> "Connecting…"
    CallState.ACTIVE -> "Connected"
    CallState.ENDED -> "Call ended"
    CallState.FAILED -> "Call failed"
}

private fun callStateColor(state: CallState): Color = when (state) {
    CallState.ACTIVE -> LinqaAccent
    CallState.FAILED, CallState.ENDED -> WarningAmber
    else -> LinqaTextFaint
}

