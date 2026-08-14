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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun AccountCreatedScreen(
    onContinue: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF4F6FB))
            .padding(horizontal = 20.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(24.dp))

        Box(
            modifier = Modifier
                .size(96.dp)
                .background(Color(0xFF20B86A), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = "✓", color = Color.White, fontSize = 48.sp, fontWeight = FontWeight.Bold)
        }

        Spacer(modifier = Modifier.height(20.dp))

        Text(
            text = "Account created!",
            color = Color(0xFF111827),
            fontSize = 34.sp,
            lineHeight = 38.sp,
            fontWeight = FontWeight.Black,
        )

        Text(
            text = "Your phone number and email\nhave been verified.",
            color = Color(0xFF475467),
            fontSize = 17.sp,
            lineHeight = 24.sp,
            modifier = Modifier.padding(top = 12.dp, bottom = 24.dp),
        )

        val rows = listOf(
            "Phone number" to "Verified",
            "Recovery email" to "Verified",
            "Account status" to "Active",
        )

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            rows.forEach { (label, status) ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFFFFFFF), RoundedCornerShape(12.dp))
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(text = "✓", color = Color(0xFF20B86A), fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text(
                        text = label,
                        color = Color(0xFF111827),
                        fontSize = 17.sp,
                        modifier = Modifier.padding(start = 12.dp).weight(1f),
                    )
                    Text(text = status, color = Color(0xFF20B86A), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        Button(
            onClick = onContinue,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E5BFF)),
        ) {
            Text("Continue to Linqa", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }
    }
}
