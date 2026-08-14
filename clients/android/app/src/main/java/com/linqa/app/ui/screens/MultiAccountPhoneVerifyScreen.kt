package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.linqa.app.network.MultiAccountApi
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaBackground
import com.linqa.app.ui.theme.LinqaText
import com.linqa.app.ui.theme.LinqaTextFaint
import kotlinx.coroutines.launch

/**
 * Multi-account phone verification (the v5 phone-verification routes) — a
 * separate track from the login OTP done at registration. Required once
 * per account before it can be added to this installation's account list
 * (server enforces `phone_identities_v2.verification_state='VERIFIED_MOBILE'`).
 */
@Composable
fun MultiAccountPhoneVerifyScreen(
    multiAccountApi: MultiAccountApi,
    onVerified: () -> Unit,
    onBack: () -> Unit,
) {
    var phone by remember { mutableStateOf("") }
    var phoneIdentityId by remember { mutableStateOf<String?>(null) }
    var challengeId by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(LinqaBackground)
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        if (challengeId == null) {
            Text("Verify this account's mobile number", color = LinqaText, fontWeight = FontWeight.Bold, fontSize = MaterialTheme.typography.headlineSmall.fontSize)
            Text(
                "Required once before this account can be added to your device.",
                color = LinqaTextFaint,
                modifier = Modifier.padding(top = 8.dp, bottom = 20.dp),
            )
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it; error = null },
                placeholder = { Text("+1 202 555 0123") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
            }
            Button(
                onClick = {
                    loading = true
                    error = null
                    scope.launch {
                        try {
                            val result = multiAccountApi.startPhoneVerification(phone.trim())
                            phoneIdentityId = result.phoneIdentityId
                            challengeId = result.challengeId
                        } catch (e: Exception) {
                            error = e.message ?: "Could not verify this number."
                        } finally {
                            loading = false
                        }
                    }
                },
                enabled = !loading && phone.trim().length >= 6,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                if (loading) CircularProgressIndicator(modifier = Modifier.padding(4.dp), color = LinqaAccent) else Text("Send code")
            }
            TextButton(onClick = onBack, modifier = Modifier.padding(top = 8.dp)) {
                Text("Cancel", color = LinqaAccent)
            }
        } else {
            Text("Enter your code", color = LinqaText, fontWeight = FontWeight.Bold, fontSize = MaterialTheme.typography.headlineSmall.fontSize)
            Text("We sent a 6-digit code to ${phone.trim()}.", color = LinqaTextFaint, modifier = Modifier.padding(top = 8.dp, bottom = 20.dp))
            OutlinedTextField(
                value = code,
                onValueChange = { if (it.length <= 6) { code = it.filter(Char::isDigit); error = null } },
                placeholder = { Text("000000") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
            }
            Button(
                onClick = {
                    loading = true
                    error = null
                    scope.launch {
                        try {
                            multiAccountApi.completePhoneVerification(phoneIdentityId!!, challengeId!!, code)
                            onVerified()
                        } catch (e: Exception) {
                            error = e.message ?: "Invalid or expired code."
                        } finally {
                            loading = false
                        }
                    }
                },
                enabled = !loading && code.length == 6,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                if (loading) CircularProgressIndicator(modifier = Modifier.padding(4.dp), color = LinqaAccent) else Text("Verify")
            }
        }
    }
}
