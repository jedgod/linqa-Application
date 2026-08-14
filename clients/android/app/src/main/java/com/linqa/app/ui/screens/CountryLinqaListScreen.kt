package com.linqa.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONObject

/**
 * One reusable list surface for CountryLinqa's several country-scoped
 * collections (world feed posts, businesses, events, joined communities) —
 * they share the same "loading → empty → row list" shape, and each pack
 * screen (LinqaWorldGoLiveScreen's sub-navigations) only ever showed a
 * simple ranked list, no bespoke layout per collection.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CountryLinqaListScreen(
    title: String,
    emptyLabel: String,
    onBack: () -> Unit,
    load: suspend () -> List<JSONObject>,
    primaryField: String,
    secondaryField: String? = null,
) {
    var items by remember { mutableStateOf<List<JSONObject>?>(null) }

    LaunchedEffect(title) {
        items = runCatching { load() }.getOrDefault(emptyList())
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Text("←") } },
                title = { Text(title, fontWeight = FontWeight.SemiBold) },
            )
        },
    ) { padding ->
        val current = items
        when {
            current == null -> Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) { CircularProgressIndicator() }

            current.isEmpty() -> Column(
                modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) { Text(emptyLabel, style = MaterialTheme.typography.bodyMedium) }

            else -> LazyColumn(modifier = Modifier.padding(padding).padding(horizontal = 16.dp)) {
                items(current) { item ->
                    Column(modifier = Modifier.padding(vertical = 12.dp)) {
                        Text(item.optString(primaryField, "—"), fontWeight = FontWeight.Bold)
                        secondaryField?.let {
                            Text(item.optString(it, ""), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}
