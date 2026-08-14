package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.linqa.app.network.CountryLinqaApi
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaBackground
import com.linqa.app.ui.theme.LinqaPanelAlt
import com.linqa.app.ui.theme.LinqaText
import com.linqa.app.ui.theme.LinqaTextFaint

data class LinqaWorldCard(val icon: String, val title: String, val subtitle: String, val onOpen: () -> Unit)

/**
 * Merged from the three overlapping "home" screens across the base,
 * go-live, and final CountryLinqa packs (CountryLinqaHomeScreen,
 * LinqaWorldGoLiveScreen, LinqaWorldFinalScreen) into one screen with the
 * superset of entry points.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LinqaWorldScreen(
    countryLinqaApi: CountryLinqaApi,
    onBack: () -> Unit,
    onOpenFeed: () -> Unit,
    onOpenPeople: () -> Unit,
    onOpenBusinesses: () -> Unit,
    onOpenEvents: () -> Unit,
    onOpenCommunities: () -> Unit,
    onOpenCountries: () -> Unit,
    onOpenRegions: () -> Unit,
) {
    var scopeLabel by remember { mutableStateOf("Loading…") }

    LaunchedEffect(Unit) {
        val prefs = runCatching { countryLinqaApi.preferences() }.getOrNull()
        scopeLabel = prefs?.mode?.replace('_', ' ') ?: "My Country"
    }

    val cards = listOf(
        LinqaWorldCard("🌐", "World Feed", "Country-scoped posts", onOpenFeed),
        LinqaWorldCard("👥", "People", "Discover across your scope", onOpenPeople),
        LinqaWorldCard("🏬", "Businesses", "Local recommendations", onOpenBusinesses),
        LinqaWorldCard("🎉", "Events", "Happening near your scope", onOpenEvents),
        LinqaWorldCard("🏘", "Communities", "Country & region groups", onOpenCommunities),
        LinqaWorldCard("🗺", "Countries", "Manage selected countries", onOpenCountries),
        LinqaWorldCard("🧭", "Regions", "Manage selected regions", onOpenRegions),
    )

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Text("←") } },
                title = { Text("Linqa World", fontWeight = FontWeight.SemiBold) },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(LinqaBackground)
                .padding(padding)
                .padding(16.dp),
        ) {
            Text("Your world. Your connections.", color = LinqaText, fontWeight = FontWeight.Bold, fontSize = MaterialTheme.typography.headlineSmall.fontSize)
            Box(
                modifier = Modifier
                    .padding(top = 8.dp, bottom = 16.dp)
                    .background(LinqaAccent.copy(alpha = 0.15f), RoundedCornerShape(20.dp))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text(scopeLabel, color = LinqaAccent, style = MaterialTheme.typography.labelMedium)
            }

            LazyVerticalGrid(columns = GridCells.Fixed(2), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(cards) { card ->
                    Column(
                        modifier = Modifier
                            .background(LinqaPanelAlt, RoundedCornerShape(16.dp))
                            .clickable(onClick = card.onOpen)
                            .padding(16.dp),
                    ) {
                        Text(card.icon, style = MaterialTheme.typography.headlineSmall)
                        Text(card.title, color = LinqaText, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                        Text(card.subtitle, color = LinqaTextFaint, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 2.dp))
                    }
                }
            }

            Text(
                "Privacy by design: CountryLinqa changes what you discover, not your verified identity. Your city stays private unless you enable it.",
                color = LinqaTextFaint,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(top = 20.dp),
            )
        }
    }
}
