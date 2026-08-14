package com.linqa.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.People
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.linqa.app.R
import com.linqa.app.model.CallRecord
import com.linqa.app.model.CommunityRecord
import com.linqa.app.model.Contact
import com.linqa.app.model.Conversation
import com.linqa.app.model.HubSnapshot
import com.linqa.app.model.MediaRecord
import com.linqa.app.ui.components.Avatar
import com.linqa.app.ui.theme.LinqaAccent
import com.linqa.app.ui.theme.LinqaBackground
import com.linqa.app.ui.theme.LinqaBorder
import com.linqa.app.ui.theme.LinqaPanel
import com.linqa.app.ui.theme.LinqaPanelAlt
import com.linqa.app.ui.theme.LinqaText
import com.linqa.app.ui.theme.LinqaTextDim
import com.linqa.app.ui.theme.LinqaTextFaint
import com.linqa.app.util.formatRelative
import com.linqa.app.util.hueFromId

private val ElectricBlue = Color(0xFF3F86FF)
private val SignalViolet = Color(0xFF9A64FF)
private val WarningAmber = Color(0xFFFFB84D)
private val HubShape = RoundedCornerShape(8.dp)

private enum class ConversationFilter(val label: String) {
    ALL("All"), UNREAD("Unread"), GROUPS("Groups"), PINNED("Pinned")
}

private enum class HubDestination(val label: String, val icon: ImageVector) {
    CHATS("Chats", Icons.AutoMirrored.Rounded.Chat),
    CALLS("Calls", Icons.Rounded.Call),
    COMMUNITIES("Communities", Icons.Rounded.People),
    MEDIA("Media", Icons.Rounded.Image),
    SETTINGS("Settings", Icons.Rounded.Settings),
}

@Composable
fun ConversationListScreen(
    hub: HubSnapshot?,
    isLoading: Boolean,
    errorMessage: String?,
    onSelect: (Conversation) -> Unit,
    onOpenSettings: () -> Unit,
    onPublishStatus: (String) -> Unit,
    onStartConversation: (Contact) -> Unit,
    onStartCall: (Contact) -> Unit,
) {
    val conversations = hub?.conversations.orEmpty()
    var query by remember { mutableStateOf("") }
    var searchVisible by remember { mutableStateOf(false) }
    var selectedFilter by remember { mutableStateOf(ConversationFilter.ALL) }
    var destination by remember { mutableStateOf(HubDestination.CHATS) }
    var statusDialogVisible by remember { mutableStateOf(false) }
    var statusDraft by remember { mutableStateOf("") }
    var composeDialogVisible by remember { mutableStateOf(false) }

    val filtered = remember(conversations, query, selectedFilter) {
        conversations
            .asSequence()
            .filter { it.title.contains(query, ignoreCase = true) }
            .filter {
                when (selectedFilter) {
                    ConversationFilter.ALL -> true
                    ConversationFilter.UNREAD -> it.unreadCount > 0
                    ConversationFilter.GROUPS -> it.isGroup
                    ConversationFilter.PINNED -> it.pinned
                }
            }
            .sortedWith(
                compareByDescending<Conversation> { it.pinned }
                    .thenByDescending { it.lastMessageAt }
            )
            .toList()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF061827), LinqaBackground, Color(0xFF020A12))
                )
            )
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            bottomBar = {
                HubBottomBar(
                    selected = destination,
                    onSelect = {
                        if (it == HubDestination.SETTINGS) onOpenSettings() else destination = it
                    },
                )
            },
        ) { scaffoldPadding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = scaffoldPadding.calculateTopPadding() + 12.dp,
                    end = 16.dp,
                    bottom = scaffoldPadding.calculateBottomPadding() + 18.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    HubHeader(
                        onMenu = onOpenSettings,
                        onSearch = { searchVisible = !searchVisible },
                        onCompose = {
                            destination = HubDestination.CHATS
                            composeDialogVisible = true
                        },
                    )
                }

                if (searchVisible && destination == HubDestination.CHATS) {
                    item {
                        SearchField(query = query, onQueryChange = { query = it })
                    }
                }

                if (destination == HubDestination.CHATS) {
                    item { WelcomePanel(status = hub?.statuses?.firstOrNull()?.body, errorMessage = errorMessage) }
                    item {
                        PeopleRail(
                            contacts = hub?.contacts.orEmpty(),
                            onStatus = { statusDialogVisible = true },
                            onContact = onStartConversation,
                        )
                    }
                    item {
                        FilterBar(
                            selected = selectedFilter,
                            conversations = conversations,
                            onSelect = { selectedFilter = it },
                        )
                    }

                    when {
                        isLoading -> item { LoadingPanel() }
                        filtered.isEmpty() -> item {
                            EmptyPanel(
                                hasQuery = query.isNotBlank(),
                                onReset = {
                                    query = ""
                                    selectedFilter = ConversationFilter.ALL
                                },
                            )
                        }
                        else -> items(filtered, key = { it.id }) { conversation ->
                            ConversationCard(
                                conversation = conversation,
                                onClick = { onSelect(conversation) },
                            )
                        }
                    }
                } else {
                    item {
                        DestinationPanel(
                            destination = destination,
                            calls = hub?.calls.orEmpty(),
                            communities = hub?.communities.orEmpty(),
                            media = hub?.media.orEmpty(),
                            contacts = hub?.contacts.orEmpty(),
                            onStartCall = onStartCall,
                        )
                    }
                }
            }
        }
    }

    if (statusDialogVisible) {
        TextEntryDialog(
            title = "My status",
            value = statusDraft,
            placeholder = "What are you working on?",
            onValueChange = { statusDraft = it.take(280) },
            onDismiss = { statusDialogVisible = false },
            onConfirm = {
                onPublishStatus(statusDraft.trim())
                statusDraft = ""
                statusDialogVisible = false
            },
        )
    }
    if (composeDialogVisible) {
        ContactPickerDialog(
            contacts = hub?.contacts.orEmpty(),
            onDismiss = { composeDialogVisible = false },
            onSelect = {
                composeDialogVisible = false
                onStartConversation(it)
            },
        )
    }
}

@Composable
private fun HubHeader(onMenu: () -> Unit, onSearch: () -> Unit, onCompose: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ActionButton(Icons.Rounded.Menu, "Open settings", onMenu)
        Spacer(Modifier.width(10.dp))
        Image(
            painter = painterResource(R.mipmap.ic_launcher),
            contentDescription = "Linqa logo",
            modifier = Modifier.size(34.dp).clip(HubShape),
            contentScale = ContentScale.Crop,
        )
        Spacer(Modifier.width(8.dp))
        Text(
            "Linqa",
            color = LinqaText,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            modifier = Modifier.weight(1f),
        )
        ActionButton(Icons.Rounded.Search, "Search conversations", onSearch)
        Spacer(Modifier.width(8.dp))
        Box(
            modifier = Modifier
                .size(42.dp)
                .clip(HubShape)
                .background(Brush.linearGradient(listOf(Color(0xFF1DE0A8), Color(0xFF00A58D))))
                .clickable(onClick = onCompose)
                .semantics { contentDescription = "Start a conversation" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Add, null, tint = Color(0xFF002A24), modifier = Modifier.size(23.dp))
        }
    }
}

@Composable
private fun ActionButton(icon: ImageVector, label: String, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(46.dp)
            .clip(HubShape)
            .background(LinqaPanel)
            .border(1.dp, LinqaBorder.copy(alpha = 0.78f), HubShape),
    ) {
        Icon(icon, contentDescription = label, tint = LinqaTextDim, modifier = Modifier.size(23.dp))
    }
}

@Composable
private fun SearchField(query: String, onQueryChange: (String) -> Unit) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        leadingIcon = { Icon(Icons.Rounded.Search, null) },
        placeholder = { Text("Search people and conversations") },
        singleLine = true,
        shape = HubShape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = LinqaPanel,
            unfocusedContainerColor = LinqaPanel,
            focusedBorderColor = LinqaAccent,
            unfocusedBorderColor = LinqaBorder,
            focusedTextColor = LinqaText,
            unfocusedTextColor = LinqaText,
            focusedLeadingIconColor = LinqaAccent,
            unfocusedLeadingIconColor = LinqaTextFaint,
            focusedPlaceholderColor = LinqaTextFaint,
            unfocusedPlaceholderColor = LinqaTextFaint,
        ),
        modifier = Modifier.fillMaxWidth().padding(bottom = 2.dp),
    )
}

@Composable
private fun WelcomePanel(status: String?, errorMessage: String?) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(HubShape)
            .background(Brush.linearGradient(listOf(Color(0xFF0E2B3D), Color(0xFF0A2336), Color(0xFF122C44))))
            .border(1.dp, Color(0xFF1A4567), HubShape)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box {
                Avatar(initials = "YO", hue = 170, size = 58)
                Box(
                    modifier = Modifier.align(Alignment.BottomEnd).size(14.dp).clip(CircleShape)
                        .background(LinqaAccent).border(2.dp, Color(0xFF0E2B3D), CircleShape)
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("Good afternoon", color = LinqaTextFaint, fontSize = 11.sp)
                Text("Welcome back", color = LinqaText, fontWeight = FontWeight.Bold, fontSize = 21.sp)
                Text(status ?: "Post a status to your contacts", color = LinqaTextDim, fontSize = 12.sp)
            }
            Icon(Icons.Rounded.ChevronRight, "Open profile", tint = LinqaTextFaint, modifier = Modifier.size(18.dp))
        }
        val coreLoaded = com.linqa.app.crypto.CoreBridge.isNativeLoaded()
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RuntimeChip(if (errorMessage == null) "Live" else "Offline", Icons.Rounded.Storage, LinqaAccent, Modifier.weight(1f))
            RuntimeChip(
                if (coreLoaded) "Core v${com.linqa.app.crypto.NativeCore.version()}" else "Core offline",
                if (coreLoaded) Icons.Rounded.Lock else Icons.Rounded.CloudOff,
                if (coreLoaded) LinqaAccent else WarningAmber,
                Modifier.weight(1.2f),
            )
            RuntimeChip("Local", Icons.Rounded.Lock, ElectricBlue, Modifier.weight(1f))
        }
    }
}

@Composable
private fun RuntimeChip(label: String, icon: ImageVector, color: Color, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.height(40.dp).clip(HubShape).background(color.copy(alpha = 0.11f))
            .border(1.dp, color.copy(alpha = 0.24f), HubShape).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, null, tint = color, modifier = Modifier.size(15.dp))
        Spacer(Modifier.width(5.dp))
        Text(label, color = color, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
private fun PeopleRail(contacts: List<Contact>, onStatus: () -> Unit, onContact: (Contact) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(
            modifier = Modifier.width(82.dp).height(112.dp).clip(HubShape).background(LinqaPanel)
                .border(1.dp, LinqaBorder, HubShape).clickable(onClick = onStatus),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(
                modifier = Modifier.size(50.dp).clip(CircleShape).border(2.dp, LinqaAccent.copy(alpha = 0.7f), CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Rounded.Add, null, tint = LinqaAccent, modifier = Modifier.size(20.dp)) }
            Spacer(Modifier.height(8.dp))
            Text("My status", color = LinqaText, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            Text("Add update", color = LinqaAccent, fontSize = 9.sp)
        }
        contacts.forEach { contact -> PersonCard(contact, onContact) }
    }
}

@Composable
private fun PersonCard(contact: Contact, onContact: (Contact) -> Unit) {
    Column(
        modifier = Modifier.width(82.dp).height(112.dp).clip(HubShape).background(LinqaPanel)
            .border(1.dp, LinqaBorder, HubShape).clickable { onContact(contact) },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box {
            Box(
                modifier = Modifier.size(54.dp).clip(CircleShape)
                    .border(2.dp, if (contact.online) LinqaAccent else ElectricBlue.copy(alpha = 0.65f), CircleShape)
                    .padding(4.dp),
            ) { Avatar(contact.initials, contact.colorHue, size = 46) }
            if (contact.online) {
                Box(
                    modifier = Modifier.align(Alignment.BottomEnd).size(12.dp).clip(CircleShape)
                        .background(LinqaAccent).border(2.dp, LinqaPanel, CircleShape)
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(contact.displayName.substringBefore(" "), color = LinqaText, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        Text(if (contact.online) "Active now" else "Recently", color = if (contact.online) LinqaAccent else LinqaTextFaint, fontSize = 9.sp)
    }
}

@Composable
private fun FilterBar(selected: ConversationFilter, conversations: List<Conversation>, onSelect: (ConversationFilter) -> Unit) {
    val counts = mapOf(
        ConversationFilter.ALL to conversations.size,
        ConversationFilter.UNREAD to conversations.count { it.unreadCount > 0 },
        ConversationFilter.GROUPS to conversations.count { it.isGroup },
        ConversationFilter.PINNED to conversations.count { it.pinned },
    )
    Row(
        modifier = Modifier.fillMaxWidth().clip(HubShape).background(LinqaPanel).border(1.dp, LinqaBorder, HubShape)
            .horizontalScroll(rememberScrollState()).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        ConversationFilter.entries.forEach { filter ->
            val active = filter == selected
            Row(
                modifier = Modifier.height(34.dp).clip(HubShape)
                    .background(if (active) LinqaAccent.copy(alpha = 0.14f) else Color.Transparent)
                    .clickable { onSelect(filter) }.padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(filter.label, color = if (active) LinqaAccent else LinqaTextDim, fontWeight = if (active) FontWeight.Bold else FontWeight.Medium, fontSize = 11.sp)
                Spacer(Modifier.width(6.dp))
                Box(
                    modifier = Modifier.clip(CircleShape).background(if (active) LinqaAccent else LinqaBorder)
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(counts[filter].toString(), color = if (active) Color(0xFF003B31) else LinqaTextDim, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun ConversationCard(conversation: Conversation, onClick: () -> Unit) {
    val hue = hueFromId(conversation.id)
    val initials = conversation.title.split(" ").take(2).joinToString("") { it.take(1) }.uppercase()
    Row(
        modifier = Modifier.fillMaxWidth().clip(HubShape)
            .background(Brush.horizontalGradient(listOf(LinqaPanel, Color(0xFF0A1D2B))))
            .border(1.dp, if (conversation.unreadCount > 0) LinqaAccent.copy(alpha = 0.24f) else LinqaBorder, HubShape)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Avatar(initials, hue, size = 46)
        }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(conversation.title, color = LinqaText, fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (conversation.muted) Icon(Icons.AutoMirrored.Rounded.VolumeOff, "Muted", tint = LinqaTextFaint, modifier = Modifier.size(14.dp))
                if (conversation.pinned) {
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.Rounded.PushPin, "Pinned", tint = ElectricBlue, modifier = Modifier.size(14.dp))
                }
            }
            Text(conversation.lastMessagePreview, color = if (conversation.unreadCount > 0) LinqaTextDim else LinqaTextFaint, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(formatRelative(conversation.lastMessageAt), color = if (conversation.unreadCount > 0) LinqaAccent else LinqaTextFaint, fontSize = 9.sp)
            if (conversation.unreadCount > 0) {
                Box(
                    modifier = Modifier.size(22.dp).clip(CircleShape).background(Brush.linearGradient(listOf(LinqaAccent, Color(0xFF00B992)))),
                    contentAlignment = Alignment.Center,
                ) { Text(conversation.unreadCount.toString(), color = Color(0xFF003B31), fontWeight = FontWeight.Bold, fontSize = 10.sp) }
            }
        }
    }
}

@Composable
private fun LoadingPanel() {
    Box(modifier = Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CircularProgressIndicator(color = LinqaAccent, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
            Text("Loading your conversations", color = LinqaTextFaint, fontSize = 12.sp)
        }
    }
}

@Composable
private fun EmptyPanel(hasQuery: Boolean, onReset: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().clip(HubShape).background(LinqaPanel).border(1.dp, LinqaBorder, HubShape)
            .clickable(onClick = onReset).padding(26.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.AutoMirrored.Rounded.Chat, null, tint = LinqaAccent, modifier = Modifier.size(30.dp))
        Text(if (hasQuery) "No matching conversations" else "Nothing here yet", color = LinqaText, fontWeight = FontWeight.Bold)
        Text("Tap to show every conversation", color = LinqaTextFaint, fontSize = 12.sp)
    }
}

@Composable
private fun DestinationPanel(
    destination: HubDestination,
    calls: List<CallRecord>,
    communities: List<CommunityRecord>,
    media: List<MediaRecord>,
    contacts: List<Contact>,
    onStartCall: (Contact) -> Unit,
) {
    val (title, detail, tint) = when (destination) {
        HubDestination.CALLS -> Triple("Calls", "${calls.size} PostgreSQL call records", ElectricBlue)
        HubDestination.COMMUNITIES -> Triple("Communities", "${communities.size} active memberships", SignalViolet)
        HubDestination.MEDIA -> Triple("Media", "${media.size} indexed encrypted assets", LinqaAccent)
        else -> Triple(destination.label, "This destination is not available yet.", LinqaTextDim)
    }
    Column(
        modifier = Modifier.fillMaxWidth().clip(HubShape).background(Brush.linearGradient(listOf(LinqaPanel, LinqaPanelAlt)))
            .border(1.dp, tint.copy(alpha = 0.28f), HubShape).padding(vertical = 42.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(modifier = Modifier.size(64.dp).clip(CircleShape).background(tint.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Icon(destination.icon, null, tint = tint, modifier = Modifier.size(30.dp))
        }
        Text(title, color = LinqaText, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        Text(detail, color = LinqaTextDim, fontSize = 13.sp, lineHeight = 19.sp)
        when (destination) {
            HubDestination.CALLS -> {
                calls.take(4).forEach { Text("${it.peerName} · ${it.callType.lowercase()} · ${it.status.lowercase()}", color = LinqaTextDim, fontSize = 12.sp) }
                contacts.firstOrNull()?.let { contact ->
                    Text("Start call with ${contact.displayName}", color = tint, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, modifier = Modifier.clickable { onStartCall(contact) }.padding(8.dp))
                }
            }
            HubDestination.COMMUNITIES -> communities.forEach { Text("${it.name} · ${it.role.lowercase()}", color = LinqaTextDim, fontSize = 12.sp) }
            HubDestination.MEDIA -> media.take(6).forEach { Text("${it.mediaType.lowercase()} · ${it.conversationTitle}", color = LinqaTextDim, fontSize = 12.sp) }
            else -> Unit
        }
    }
}

@Composable
private fun TextEntryDialog(
    title: String,
    value: String,
    placeholder: String,
    onValueChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(value, onValueChange, placeholder = { Text(placeholder) }) },
        confirmButton = { TextButton(onClick = onConfirm, enabled = value.isNotBlank()) { Text("Post") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun ContactPickerDialog(contacts: List<Contact>, onDismiss: () -> Unit, onSelect: (Contact) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New conversation") },
        text = {
            Column {
                contacts.forEach { contact ->
                    Text(contact.displayName, modifier = Modifier.fillMaxWidth().clickable { onSelect(contact) }.padding(vertical = 12.dp))
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun HubBottomBar(selected: HubDestination, onSelect: (HubDestination) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color(0xFF091D2C), Color(0xFF071621))))
            .border(BorderStroke(1.dp, LinqaBorder.copy(alpha = 0.72f)))
            .padding(horizontal = 6.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.SpaceAround,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HubDestination.entries.forEach { destination ->
            val active = destination == selected
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clip(HubShape)
                    .clickable { onSelect(destination) }
                    .padding(vertical = 5.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(width = 40.dp, height = 28.dp)
                        .clip(HubShape)
                        .background(if (active) LinqaAccent.copy(alpha = 0.12f) else LinqaPanelAlt.copy(alpha = 0.8f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(destination.icon, destination.label, tint = if (active) LinqaAccent else LinqaTextFaint, modifier = Modifier.size(19.dp))
                }
                Text(destination.label, color = if (active) LinqaAccent else LinqaTextFaint, fontSize = if (destination == HubDestination.COMMUNITIES) 8.sp else 9.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Medium, maxLines = 1)
            }
        }
    }
}
