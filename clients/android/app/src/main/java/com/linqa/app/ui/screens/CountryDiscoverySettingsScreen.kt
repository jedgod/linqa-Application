package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.linqa.app.network.CountryLinqaApi
import com.linqa.app.network.CountryLinqaPreferences
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaPanelAlt
import com.linqa.app.ui.theme.LinqaText
import com.linqa.app.ui.theme.LinqaTextFaint
import kotlinx.coroutines.launch

private val MODE_LABEL = mapOf(
    "MY_COUNTRY" to "My Country",
    "SELECTED_COUNTRIES" to "Selected Countries",
    "REGION" to "Regional Communities",
    "GLOBAL" to "Worldwide",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CountryDiscoverySettingsScreen(
    countryLinqaApi: CountryLinqaApi,
    onBack: () -> Unit,
    onOpenCountryPicker: () -> Unit,
    onOpenRegionPicker: () -> Unit,
) {
    var prefs by remember { mutableStateOf<CountryLinqaPreferences?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        prefs = runCatching { countryLinqaApi.preferences() }.getOrNull()
    }

    Scaffold(
        containerColor = com.linqa.app.ui.theme.LinqaBackground,
        topBar = {
            TopAppBar(
                colors = androidx.compose.material3.TopAppBarDefaults.topAppBarColors(
                    containerColor = com.linqa.app.ui.theme.LinqaBackground,
                    titleContentColor = com.linqa.app.ui.theme.LinqaText,
                    navigationIconContentColor = com.linqa.app.ui.theme.LinqaTextDim,
                ),
                navigationIcon = { IconButton(onClick = onBack) { Text("←", color = com.linqa.app.ui.theme.LinqaText) } },
                title = { Text("Discovery", fontWeight = FontWeight.SemiBold) },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .background(com.linqa.app.ui.theme.LinqaBackground)
                .padding(padding)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Verified country: ${prefs?.verifiedCountryCode ?: "Pending"}",
                color = LinqaTextFaint,
                modifier = Modifier.padding(bottom = 4.dp),
            )

            listOf("MY_COUNTRY", "SELECTED_COUNTRIES", "REGION", "GLOBAL").forEach { mode ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(if (prefs?.mode == mode) LinqaAccent.copy(alpha = 0.15f) else LinqaPanelAlt, RoundedCornerShape(12.dp))
                        .clickable {
                            when (mode) {
                                "SELECTED_COUNTRIES" -> onOpenCountryPicker()
                                "REGION" -> onOpenRegionPicker()
                                else -> scope.launch {
                                    prefs = runCatching { countryLinqaApi.savePreferences(mode = mode) }.getOrNull() ?: prefs
                                }
                            }
                        }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(MODE_LABEL[mode] ?: mode, color = LinqaText)
                    if (prefs?.mode == mode) Text("●", color = LinqaAccent) else Text("○", color = LinqaTextFaint)
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(LinqaPanelAlt, RoundedCornerShape(14.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Show my city", color = LinqaText)
                    Text("Off by default — your city stays private.", color = LinqaTextFaint, style = MaterialTheme.typography.labelSmall)
                }
                Switch(
                    checked = prefs?.showCity ?: false,
                    onCheckedChange = { checked ->
                        scope.launch {
                            val current = prefs ?: return@launch
                            prefs = runCatching {
                                countryLinqaApi.savePreferences(
                                    mode = current.mode,
                                    selectedCountries = current.selectedCountries,
                                    selectedRegions = current.selectedRegions,
                                    locationPrecision = if (checked) "CITY" else "COUNTRY",
                                    showCity = checked,
                                )
                            }.getOrNull() ?: current
                        }
                    },
                )
            }
        }
    }
}
