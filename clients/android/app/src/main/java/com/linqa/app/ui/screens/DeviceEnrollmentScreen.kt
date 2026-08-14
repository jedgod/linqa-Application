package com.linqa.app.ui.screens

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.linqa.app.network.EnrollmentApi
import com.linqa.app.network.KeyPackageApi

/**
 * Runs automatically once a session exists but this device isn't enrolled
 * yet: generates this device's real Ed25519/X25519 identity, signs the
 * enrollment proof, and publishes a key package so other users can resolve
 * this device for calls/messaging.
 */
@Composable
fun DeviceEnrollmentScreen(
    enrollmentApi: EnrollmentApi,
    keyPackageApi: KeyPackageApi,
    onEnrolled: () -> Unit,
) {
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            enrollmentApi.enroll(deviceName = Build.MODEL ?: "Android device")
            keyPackageApi.publishOwnKeyPackage()
            onEnrolled()
        } catch (e: Exception) {
            error = e.message ?: "Device enrollment failed."
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF4F6FB))
            .padding(horizontal = 20.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (error == null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.White, RoundedCornerShape(16.dp))
                    .border(1.dp, Color(0xFFE6E9F1), RoundedCornerShape(16.dp))
                    .padding(vertical = 32.dp, horizontal = 20.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        modifier = Modifier
                            .size(72.dp)
                            .background(Color(0xFF1E5BFF), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            color = Color.White,
                            strokeWidth = 3.dp,
                            modifier = Modifier.size(36.dp),
                        )
                    }

                    Spacer(modifier = Modifier.height(18.dp))

                    Text(
                        "Verifying this device…",
                        color = Color(0xFF111827),
                        fontSize = 32.sp,
                        lineHeight = 36.sp,
                        fontWeight = FontWeight.Black,
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        "Generating your device's security keys.",
                        color = Color(0xFF475467),
                        fontSize = 16.sp,
                        lineHeight = 22.sp,
                        fontWeight = FontWeight.Normal,
                    )
                }
            }
        } else {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.White, RoundedCornerShape(16.dp))
                    .border(1.dp, Color(0xFFE6E9F1), RoundedCornerShape(16.dp))
                    .padding(vertical = 26.dp, horizontal = 20.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Device verification failed", color = Color(0xFF111827), fontWeight = FontWeight.Bold, fontSize = 24.sp)
                    Text(error!!, color = Color(0xFF475467), modifier = Modifier.padding(top = 8.dp), fontSize = 14.sp)
                    Button(
                        onClick = { error = null },
                        modifier = Modifier
                            .padding(top = 16.dp)
                            .fillMaxWidth()
                            .height(52.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E5BFF)),
                    ) {
                        Text("Try again", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
