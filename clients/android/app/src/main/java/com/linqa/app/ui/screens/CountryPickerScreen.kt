package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.unit.dp
import com.linqa.app.network.CountryLinqaApi
import com.linqa.app.network.CountryLinqaCountry
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaText
import com.linqa.app.ui.theme.LinqaTextFaint
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CountryPickerScreen(
    countryLinqaApi: CountryLinqaApi,
    onBack: () -> Unit,
    onDone: () -> Unit,
) {
    var countries by remember { mutableStateOf(listOf<CountryLinqaCountry>()) }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        countries = runCatching { countryLinqaApi.catalog().countries }.getOrDefault(emptyList())
    }

    val filtered = countries.filter {
        query.isBlank() || it.name.contains(query, ignoreCase = true) || it.code.contains(query, ignoreCase = true)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Text("←") } },
                title = { Text("Selected countries") },
            )
        },
        bottomBar = {
            Button(
                onClick = {
                    saving = true
                    scope.launch {
                        runCatching {
                            countryLinqaApi.savePreferences(mode = "SELECTED_COUNTRIES", selectedCountries = selected.toList())
                        }
                        saving = false
                        onDone()
                    }
                },
                enabled = selected.isNotEmpty() && !saving,
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            ) {
                Text(if (saving) "Saving…" else "Save ${selected.size} selected")
            }
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding).padding(horizontal = 16.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Search countries") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp),
            )
            LazyColumn {
                items(filtered, key = { it.code }) { country ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                selected = if (country.code in selected) selected - country.code else selected + country.code
                            }
                            .padding(vertical = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(country.name, color = LinqaText)
                            Text(country.callingCode ?: "", color = LinqaTextFaint, style = MaterialTheme.typography.labelSmall)
                        }
                        if (country.code in selected) {
                            Text("✓", color = LinqaAccent, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
