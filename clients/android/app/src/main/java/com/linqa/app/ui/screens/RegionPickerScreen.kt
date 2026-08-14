package com.linqa.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
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
import com.linqa.app.network.CountryLinqaRegion
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaText
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegionPickerScreen(
    countryLinqaApi: CountryLinqaApi,
    onBack: () -> Unit,
    onDone: () -> Unit,
) {
    var regions by remember { mutableStateOf(listOf<CountryLinqaRegion>()) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        regions = runCatching { countryLinqaApi.catalog().regions.filter { it.code != "AF" } }.getOrDefault(emptyList())
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Text("←") } },
                title = { Text("Regions") },
            )
        },
        bottomBar = {
            Button(
                onClick = {
                    saving = true
                    scope.launch {
                        runCatching {
                            countryLinqaApi.savePreferences(mode = "REGION", selectedRegions = selected.toList())
                        }
                        saving = false
                        onDone()
                    }
                },
                enabled = selected.isNotEmpty() && !saving,
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            ) {
                Text(if (saving) "Saving…" else "Save regions")
            }
        },
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding).padding(horizontal = 16.dp)) {
            items(regions, key = { it.code }) { region ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { selected = if (region.code in selected) selected - region.code else selected + region.code }
                        .padding(vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(region.name, color = LinqaText)
                    if (region.code in selected) {
                        Text("✓", color = LinqaAccent, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
