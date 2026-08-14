package com.linqa.app.ui.screens

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
import androidx.compose.foundation.layout.width
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
import kotlinx.coroutines.delay

@Composable
fun CarrierCheckScreen(
    onDone: () -> Unit,
) {
    var finalizing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        delay(1400)
        finalizing = true
        delay(700)
        onDone()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .padding(horizontal = 20.dp, vertical = 28.dp),
    ) {
        Text(
            text = "Verifying number",
            color = Color(0xFF111827),
            fontSize = 46.sp,
            lineHeight = 52.sp,
            fontWeight = FontWeight.Black,
        )

        Spacer(modifier = Modifier.height(10.dp))

        Text(
            text = "Please wait while we check if this is a genuine mobile number.",
            color = Color(0xFF475467),
            fontSize = 20.sp,
            lineHeight = 28.sp,
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 28.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (!finalizing) {
                CircularProgressIndicator(
                    modifier = Modifier.size(94.dp),
                    strokeWidth = 6.dp,
                    color = Color(0xFF0F59D9),
                    trackColor = Color(0xFFDCE8FF),
                )
            } else {
                CircularProgressIndicator(
                    modifier = Modifier.size(84.dp),
                    strokeWidth = 5.dp,
                    color = Color(0xFF0F59D9),
                    trackColor = Color(0xFFF1F5F9),
                )
            }
        }

        val rows = listOf(
            "Checking carrier" to true,
            "Checking line type" to true,
            "Checking number reputation" to true,
            "Finalizing..." to false,
        )

        rows.forEach { (label, isComplete) ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(vertical = 8.dp),
            ) {
                if (isComplete) {
                    Text(text = "✓", color = Color(0xFF24B36B), fontSize = 24.sp, fontWeight = FontWeight.Bold)
                } else {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = Color(0xFF0F59D9),
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = label,
                    color = Color(0xFF111827),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Normal,
                )
            }
        }
    }
}
