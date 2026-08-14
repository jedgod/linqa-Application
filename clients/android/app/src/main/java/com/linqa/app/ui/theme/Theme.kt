package com.linqa.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val LinqaBackground = Color(0xFF061824)
val LinqaPanel = Color(0xFF0D2332)
val LinqaPanelAlt = Color(0xFF132F40)
val LinqaBorder = Color(0xFF1B3D4F)
val LinqaText = Color(0xFFF3F8FD)
val LinqaTextDim = Color(0xFFABBFCE)
val LinqaTextFaint = Color(0xFF7D8FA3)
val LinqaAccent = Color(0xFF19D7A4)
val LinqaBubbleMine = Color(0xFF087D70)
val LinqaBubbleTheirs = Color(0xFF102A3C)

private val LinqaColorScheme = darkColorScheme(
    primary = LinqaAccent,
    background = LinqaBackground,
    surface = LinqaPanel,
    surfaceVariant = LinqaPanelAlt,
    onBackground = LinqaText,
    onSurface = LinqaText,
    outline = LinqaBorder,
)

@Composable
fun LinqaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LinqaColorScheme,
        content = content,
    )
}
