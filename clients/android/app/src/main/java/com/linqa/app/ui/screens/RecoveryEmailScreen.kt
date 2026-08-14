package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.linqa.app.network.RecoveryEmailApi
import kotlinx.coroutines.launch

@Composable
fun RecoveryEmailScreen(
    recoveryEmailApi: RecoveryEmailApi,
    onLinked: () -> Unit,
    onBack: () -> Unit,
) {
    var email by remember { mutableStateOf("jerry.diabor@example.com") }
    var challengeId by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .padding(horizontal = 20.dp, vertical = 28.dp),
    ) {
        if (challengeId == null) {
            Text(
                text = "Add recovery email",
                color = Color(0xFF111827),
                fontSize = 42.sp,
                lineHeight = 48.sp,
                fontWeight = FontWeight.Black,
            )
            Text(
                text = "Use a recovery email to reset your account and keep it secure.",
                color = Color(0xFF475467),
                fontSize = 20.sp,
                lineHeight = 28.sp,
                modifier = Modifier.padding(top = 10.dp, bottom = 18.dp),
            )
            Text(
                text = "Email address",
                color = Color(0xFF475467),
                fontSize = 16.sp,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .background(Color(0xFFF7F7F9), RoundedCornerShape(10.dp))
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                androidx.compose.material3.TextField(
                    value = email,
                    onValueChange = { email = it; error = null },
                    singleLine = true,
                    placeholder = { Text("you@example.com") },
                    modifier = Modifier.fillMaxWidth(),
                    colors = androidx.compose.material3.TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                    ),
                )
            }
            error?.let {
                Text(it, color = Color(0xFFB3261E), fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
            }
            Spacer(modifier = Modifier.height(14.dp))
            Button(
                onClick = {
                    loading = true
                    error = null
                    scope.launch {
                        try {
                            challengeId = recoveryEmailApi.start(email.trim()).challengeId
                        } catch (e: Exception) {
                            error = e.message ?: "Could not send code."
                        } finally {
                            loading = false
                        }
                    }
                },
                enabled = !loading && email.contains("@"),
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F59D9)),
            ) {
                if (loading) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.padding(4.dp).width(20.dp).height(20.dp))
                } else {
                    Text("Send Code", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White)
                }
            }
            Spacer(modifier = Modifier.height(10.dp))
            Text(
                text = "Why is this important?",
                color = Color(0xFF0F59D9),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        } else {
            Text(
                text = "Verify your email",
                color = Color(0xFF111827),
                fontSize = 46.sp,
                lineHeight = 52.sp,
                fontWeight = FontWeight.Black,
            )
            Text(
                text = "We sent a 6-digit code to\n${email}",
                color = Color(0xFF475467),
                fontSize = 22.sp,
                lineHeight = 30.sp,
                modifier = Modifier.padding(top = 12.dp, bottom = 18.dp),
            )

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                repeat(6) { index ->
                    val active = index < code.length
                    Box(
                        modifier = Modifier
                            .width(52.dp)
                            .height(60.dp)
                            .background(if (active) Color(0xFFEFF6FF) else Color(0xFFF7F7F9), RoundedCornerShape(8.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (active) {
                            Text(code[index].toString(), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color(0xFF111827))
                        }
                    }
                }
            }
            Text(
                text = "Resend code in 00:32",
                color = Color(0xFF667085),
                fontSize = 18.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 18.dp),
            )
            Text(
                text = "Didn't receive code?",
                color = Color(0xFF0F59D9),
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp),
            )
            error?.let {
                Text(it, color = Color(0xFFB3261E), fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
            }
            Column(modifier = Modifier.fillMaxWidth().padding(top = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (row in listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("", "0", "⌫"))) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                        row.forEach { key ->
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(68.dp)
                                    .background(Color(0xFFF4F6F8), RoundedCornerShape(12.dp))
                                    .padding(0.dp)
                                    .let { base ->
                                        if (key.isEmpty()) base else base.clickable(enabled = true) {
                                            if (key == "⌫") {
                                                if (code.isNotEmpty()) code = code.dropLast(1)
                                            } else if (code.length < 6) {
                                                code += key
                                            }
                                        }
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (key.isEmpty()) {
                                    Box(modifier = Modifier.size(24.dp))
                                } else {
                                    Text(text = key, color = Color(0xFF111827), fontSize = 28.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
            }
            Spacer(modifier = Modifier.weight(1f))
            Button(
                onClick = {
                    loading = true
                    error = null
                    scope.launch {
                        try {
                            recoveryEmailApi.verify(challengeId!!, code)
                            onLinked()
                        } catch (e: Exception) {
                            error = e.message ?: "Invalid or expired code."
                        } finally {
                            loading = false
                        }
                    }
                },
                enabled = !loading && code.length == 6,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F59D9)),
            ) {
                if (loading) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.width(20.dp).height(20.dp))
                } else {
                    Text("Verify Email", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White)
                }
            }
        }
    }
}
