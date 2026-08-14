package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.linqa.app.network.CountryLinqaApi
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaBackground
import com.linqa.app.ui.theme.LinqaPanelAlt
import com.linqa.app.ui.theme.LinqaText
import com.linqa.app.ui.theme.LinqaTextFaint
import kotlinx.coroutines.launch

private data class ModeOption(val mode: String, val title: String, val description: String)

private val MODES = listOf(
    ModeOption("MY_COUNTRY", "My Country", "See people and content from your verified country."),
    ModeOption("SELECTED_COUNTRIES", "Selected Countries", "Pick specific countries to connect across."),
    ModeOption("REGION", "My Region", "Discover across a broader geographic region."),
    ModeOption("GLOBAL", "Worldwide", "No geographic limits."),
)

@Composable
fun CountryScopeOnboardingScreen(
    countryLinqaApi: CountryLinqaApi,
    verifiedCountryName: String?,
    onOpenCountryPicker: () -> Unit,
    onOpenRegionPicker: () -> Unit,
    onContinue: () -> Unit,
) {
    var selected by remember { mutableStateOf("MY_COUNTRY") }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(LinqaBackground)
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("CREATE LINQA ACCOUNT", color = LinqaAccent, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
        Text(
            "Choose your discovery scope",
            color = LinqaText,
            fontWeight = FontWeight.Bold,
            fontSize = MaterialTheme.typography.headlineSmall.fontSize,
            modifier = Modifier.padding(top = 4.dp, bottom = 6.dp),
        )
        Text(
            verifiedCountryName?.let { "Your verified country is $it." } ?: "Verifying your country…",
            color = LinqaTextFaint,
            modifier = Modifier.padding(bottom = 20.dp),
        )

        MODES.forEach { option ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 10.dp)
                    .background(
                        if (selected == option.mode) LinqaAccent.copy(alpha = 0.15f) else LinqaPanelAlt,
                        RoundedCornerShape(14.dp),
                    )
                    .clickable { selected = option.mode }
                    .padding(14.dp),
            ) {
                Text(option.title, color = LinqaText, fontWeight = FontWeight.Bold)
                Text(option.description, color = LinqaTextFaint, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 2.dp))
            }
        }

        Text(
            when {
                saving -> "Saving…"
                selected == "SELECTED_COUNTRIES" -> "Continue to choose countries →"
                selected == "REGION" -> "Continue to choose a region →"
                else -> "Continue →"
            },
            color = LinqaAccent,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp)
                .clickable(enabled = !saving) {
                    when (selected) {
                        "SELECTED_COUNTRIES" -> onOpenCountryPicker()
                        "REGION" -> onOpenRegionPicker()
                        else -> {
                            saving = true
                            scope.launch {
                                runCatching { countryLinqaApi.savePreferences(mode = selected) }
                                saving = false
                                onContinue()
                            }
                        }
                    }
                },
        )
    }
}
