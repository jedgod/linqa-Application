package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaBackground
import com.linqa.app.ui.theme.LinqaPanelAlt
import com.linqa.app.ui.theme.LinqaText
import com.linqa.app.ui.theme.LinqaTextFaint

@Composable
fun CountryVerificationReviewScreen(
    verifiedCountry: String?,
    claimedCountry: String?,
    onReverify: () -> Unit,
    onSupport: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(LinqaBackground)
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Country mismatch detected", color = LinqaText, fontWeight = FontWeight.Bold, fontSize = MaterialTheme.typography.headlineSmall.fontSize)
        Text(
            "Travel or a VPN can cause this. Linqa never changes your account country automatically.",
            color = LinqaTextFaint,
            modifier = Modifier.padding(top = 8.dp, bottom = 20.dp),
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(LinqaPanelAlt, RoundedCornerShape(14.dp))
                .padding(16.dp),
        ) {
            Text("Verified mobile country: ${verifiedCountry ?: "Unknown"}", color = LinqaText)
            claimedCountry?.let {
                Text("Claimed/selected: $it", color = LinqaAccent, modifier = Modifier.padding(top = 6.dp))
            }
        }

        Button(onClick = onReverify, modifier = Modifier.fillMaxWidth().padding(top = 20.dp)) {
            Text("Re-verify mobile number")
        }
        OutlinedButton(onClick = onSupport, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) {
            Text("Contact support")
        }
    }
}
