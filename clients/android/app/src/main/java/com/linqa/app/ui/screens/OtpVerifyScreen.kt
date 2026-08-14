package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.linqa.app.network.AuthApi
import com.linqa.app.network.VerifyResult
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaBackground
import com.linqa.app.ui.theme.LinqaBorder
import com.linqa.app.ui.theme.LinqaText
import com.linqa.app.ui.theme.LinqaTextDim
import kotlinx.coroutines.launch

@Composable
fun OtpVerifyScreen(
    authApi: AuthApi,
    identifier: String,
    challengeId: String,
    onVerified: () -> Unit,
    onBack: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(LinqaBackground)
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.Top,
    ) {
        Spacer(modifier = Modifier.height(94.dp))

        Text(
            text = "Enter your code",
            color = LinqaText,
            fontSize = 42.sp,
            lineHeight = 46.sp,
            fontWeight = FontWeight.Bold,
        )

        Spacer(modifier = Modifier.height(14.dp))

        Text(
            text = "We sent a 6-digit code to $identifier.",
            color = LinqaTextDim,
            fontSize = 18.sp,
            lineHeight = 24.sp,
            fontWeight = FontWeight.Normal,
        )

        Spacer(modifier = Modifier.height(22.dp))

        OutlinedTextField(
            value = code,
            onValueChange = {
                if (it.length <= 6) {
                    code = it.filter(Char::isDigit)
                    error = null
                }
            },
            singleLine = true,
            placeholder = { Text("000000", color = LinqaTextDim) },
            textStyle = MaterialTheme.typography.bodyLarge.copy(
                color = LinqaText,
                fontSize = 18.sp,
            ),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = LinqaText,
                unfocusedTextColor = LinqaText,
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                focusedBorderColor = LinqaBorder,
                unfocusedBorderColor = LinqaBorder,
                cursorColor = LinqaAccent,
            ),
            shape = RoundedCornerShape(12.dp),
        )

        error?.let {
            Text(
                text = it,
                color = MaterialTheme.colorScheme.error,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 10.dp),
            )
        }

        Spacer(modifier = Modifier.height(18.dp))

        Button(
            onClick = {
                if (!code.matches(Regex("^\\d{6}$"))) {
                    error = "Enter the 6-digit code."
                    return@Button
                }
                loading = true
                error = null
                scope.launch {
                    try {
                        when (val result = authApi.verifyChallenge(challengeId, code)) {
                            is VerifyResult.Authenticated -> onVerified()
                            VerifyResult.RegistrationRequired -> {
                                authApi.register(challengeId)
                                onVerified()
                            }
                        }
                    } catch (e: Exception) {
                        error = e.message ?: "Invalid or expired code."
                    } finally {
                        loading = false
                    }
                }
            },
            enabled = !loading && code.length == 6,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth().height(56.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color(0xFF4C5A68),
                contentColor = Color(0xFFF3F6FB),
                disabledContainerColor = Color(0xFF4C5A68),
                disabledContentColor = Color(0xFF97A5B3),
            ),
        ) {
            if (loading) {
                CircularProgressIndicator(color = LinqaText, modifier = Modifier.height(20.dp).padding(end = 8.dp))
            }
            Text(
                text = if (loading) "Verifying" else "Verify",
                color = LinqaText,
                fontSize = 18.sp,
                fontWeight = FontWeight.Medium,
            )
        }

        Spacer(modifier = Modifier.height(18.dp))

        TextButton(
            onClick = onBack,
            modifier = Modifier.align(androidx.compose.ui.Alignment.Start),
        ) {
            Text(
                text = "Use a different phone or email",
                color = LinqaAccent,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
