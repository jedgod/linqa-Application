package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import com.linqa.app.crypto.CoreBridge
import com.linqa.app.model.DevicePlatform
import com.linqa.app.model.LinkedDevice
import com.linqa.app.model.Profile
import com.linqa.app.ui.components.Avatar
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaPanelAlt
import com.linqa.app.ui.theme.LinqaTextFaint
import com.linqa.app.util.formatRelative
import kotlinx.coroutines.launch

private val PLATFORM_ICON = mapOf(
    DevicePlatform.WEB to "🌐",
    DevicePlatform.DESKTOP to "🖥",
    DevicePlatform.ANDROID to "📱",
    DevicePlatform.IOS to "📱",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onAddRecoveryEmail: (() -> Unit)? = null,
    onOpenDiscovery: (() -> Unit)? = null,
    onOpenLinqaWorld: (() -> Unit)? = null,
    onOpenAccountSwitcher: (() -> Unit)? = null,
) {
    var profile by remember { mutableStateOf<Profile?>(null) }
    var devices by remember { mutableStateOf(listOf<LinkedDevice>()) }
    var linkCode by remember { mutableStateOf<String?>(null) }
    var linking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        profile = CoreBridge.getProfile()
        devices = CoreBridge.listDevices()
    }

    Scaffold(
        containerColor = com.linqa.app.ui.theme.LinqaBackground,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = com.linqa.app.ui.theme.LinqaBackground,
                    titleContentColor = com.linqa.app.ui.theme.LinqaText,
                    navigationIconContentColor = com.linqa.app.ui.theme.LinqaTextDim,
                    actionIconContentColor = com.linqa.app.ui.theme.LinqaTextDim,
                ),
                navigationIcon = { IconButton(onClick = onBack) { Text("←", color = com.linqa.app.ui.theme.LinqaText) } },
                title = { Text("Settings", fontWeight = FontWeight.SemiBold) },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .background(com.linqa.app.ui.theme.LinqaBackground)
                .padding(padding)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            profile?.let { p ->
                SettingsSection(title = "Profile") {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(com.linqa.app.ui.theme.LinqaPanel, RoundedCornerShape(14.dp))
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(initials = "YOU", hue = 230, size = 48)
                        Box(modifier = Modifier.width(12.dp))
                        Column {
                            Text(p.displayName, fontWeight = FontWeight.SemiBold, color = com.linqa.app.ui.theme.LinqaText)
                            Text(p.username, style = MaterialTheme.typography.bodySmall, color = com.linqa.app.ui.theme.LinqaTextFaint)
                        }
                    }
                }

                SettingsSection(title = "Security") {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(com.linqa.app.ui.theme.LinqaPanelAlt, RoundedCornerShape(14.dp))
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .background(LinqaAccent.copy(alpha = 0.15f), RoundedCornerShape(8.dp))
                                .padding(horizontal = 10.dp, vertical = 5.dp),
                        ) {
                            Text("Device enrollment pending", color = LinqaAccent, style = MaterialTheme.typography.labelMedium)
                        }
                        Text(
                            p.fingerprint,
                            style = MaterialTheme.typography.bodySmall,
                            color = com.linqa.app.ui.theme.LinqaTextFaint,
                        )
                        if (onAddRecoveryEmail != null) {
                            Button(
                                onClick = onAddRecoveryEmail,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = com.linqa.app.ui.theme.LinqaPanelAlt,
                                    contentColor = com.linqa.app.ui.theme.LinqaText,
                                ),
                            ) {
                                Text("Add recovery email")
                            }
                        }
                        if (onOpenAccountSwitcher != null) {
                            Button(
                                onClick = onOpenAccountSwitcher,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = com.linqa.app.ui.theme.LinqaPanelAlt,
                                    contentColor = com.linqa.app.ui.theme.LinqaText,
                                ),
                            ) {
                                Text("Switch account")
                            }
                        }
                    }
                }
            }

            if (onOpenDiscovery != null || onOpenLinqaWorld != null) {
                SettingsSection(title = "CountryLinqa") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        onOpenLinqaWorld?.let {
                            Button(
                                onClick = it,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = com.linqa.app.ui.theme.LinqaPanelAlt,
                                    contentColor = com.linqa.app.ui.theme.LinqaText,
                                ),
                            ) { Text("Open Linqa World") }
                        }
                        onOpenDiscovery?.let {
                            Button(
                                onClick = it,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = com.linqa.app.ui.theme.LinqaPanelAlt,
                                    contentColor = com.linqa.app.ui.theme.LinqaText,
                                ),
                            ) { Text("Discovery settings") }
                        }
                    }
                }
            }

            SettingsSection(title = "Linked devices") {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(com.linqa.app.ui.theme.LinqaPanel, RoundedCornerShape(14.dp))
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    devices.forEach { device ->
                        DeviceRow(device)
                    }

                    Button(
                        onClick = {
                            linking = true
                            linkCode = null
                            scope.launch {
                                linkCode = CoreBridge.beginDeviceLink()
                                linking = false
                            }
                        },
                        enabled = !linking,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 10.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = com.linqa.app.ui.theme.LinqaAccent,
                            contentColor = com.linqa.app.ui.theme.LinqaBackground,
                        ),
                    ) {
                        Text(if (linking) "Generating code…" else "+ Link a new device")
                    }

                    linkCode?.let { code ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 12.dp),
                            colors = androidx.compose.material3.CardDefaults.cardColors(containerColor = com.linqa.app.ui.theme.LinqaPanelAlt),
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(14.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Text(code, fontWeight = FontWeight.Bold, color = LinqaAccent, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "Enter this code on the new device. It expires in 5 minutes.",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = com.linqa.app.ui.theme.LinqaTextFaint,
                                    modifier = Modifier.padding(top = 4.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable () -> Unit) {
    Column {
        Text(
            title.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = com.linqa.app.ui.theme.LinqaTextFaint,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        content()
    }
}

@Composable
private fun DeviceRow(device: LinkedDevice) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(30.dp)
                .background(LinqaPanelAlt, RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(PLATFORM_ICON[device.platform] ?: "📱")
        }
        Box(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(device.name, style = MaterialTheme.typography.bodyMedium, color = com.linqa.app.ui.theme.LinqaText)
            Text(
                if (device.isCurrent) "Active now" else "Active ${formatRelative(device.lastActive)} ago",
                style = MaterialTheme.typography.labelSmall,
                color = com.linqa.app.ui.theme.LinqaTextFaint,
            )
        }
        if (device.isCurrent) {
            Text(
                "THIS DEVICE",
                style = MaterialTheme.typography.labelSmall,
                color = LinqaAccent,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
