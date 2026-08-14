package com.linqa.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.linqa.app.model.Conversation
import com.linqa.app.model.Message
import com.linqa.app.model.MessageStatus
import com.linqa.app.crypto.CoreBridge
import com.linqa.app.messages.E2eeMessageRepository
import com.linqa.app.ui.theme.LinqaBubbleMine
import com.linqa.app.ui.theme.LinqaBubbleTheirs
import com.linqa.app.util.formatClock
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val STATUS_GLYPH = mapOf(
    MessageStatus.SENDING to "○",
    MessageStatus.SENT to "✓",
    MessageStatus.DELIVERED to "✓✓",
    MessageStatus.READ to "✓✓",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    conversation: Conversation,
    peerOnline: Boolean = false,
    onBack: () -> Unit,
    onStartCall: ((peerUserId: String, video: Boolean) -> Unit)? = null,
    messageRepository: E2eeMessageRepository? = null,
) {
    var messages by remember(conversation.id) { mutableStateOf(listOf<Message>()) }
    var draft by remember(conversation.id) { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    LaunchedEffect(conversation.id) {
        messages = CoreBridge.listMessages(conversation.id)
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    val peerUserId = if (!conversation.isGroup) conversation.participantIds.firstOrNull() else null

    // Real ciphertext-only delivery (core/src/envelope.rs via NativeCore, server/src/routes/relay.ts)
    // is only wired for 1:1 conversations here; group E2E (MLS) remains separately gated, so group
    // chats keep using the pre-existing local-only CoreBridge echo.
    if (peerUserId != null && messageRepository != null) {
        LaunchedEffect(conversation.id) {
            while (true) {
                val received = runCatching { messageRepository.receivePending() }.getOrDefault(emptyList())
                val known = messages.mapTo(mutableSetOf()) { it.id }
                val incoming = received
                    .filter { it.clientMessageId !in known }
                    .map { decrypted ->
                        Message(
                            id = decrypted.clientMessageId,
                            conversationId = conversation.id,
                            senderId = peerUserId,
                            text = decrypted.text,
                            sentAt = System.currentTimeMillis(),
                            status = MessageStatus.DELIVERED,
                            isMine = false,
                        )
                    }
                if (incoming.isNotEmpty()) messages = messages + incoming
                delay(4000)
            }
        }
    }

    fun send() {
        val text = draft.trim()
        if (text.isEmpty()) return
        draft = ""
        val optimistic = Message(
            id = "pending-${System.currentTimeMillis()}",
            conversationId = conversation.id,
            senderId = "me",
            text = text,
            sentAt = System.currentTimeMillis(),
            status = MessageStatus.SENDING,
            isMine = true,
        )
        messages = messages + optimistic
        scope.launch {
            if (peerUserId != null && messageRepository != null) {
                val result = runCatching { messageRepository.sendText(peerUserId, text) }
                messages = messages.map {
                    if (it.id != optimistic.id) it
                    else it.copy(status = if (result.isSuccess) MessageStatus.SENT else MessageStatus.SENDING)
                }
            } else {
                val sent = CoreBridge.sendMessage(conversation.id, text)
                messages = messages.map { if (it.id == optimistic.id) sent else it }
            }
        }
    }

    Scaffold(
        containerColor = com.linqa.app.ui.theme.LinqaBackground,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF0A1B2B),
                    titleContentColor = com.linqa.app.ui.theme.LinqaText,
                    navigationIconContentColor = com.linqa.app.ui.theme.LinqaTextDim,
                    actionIconContentColor = com.linqa.app.ui.theme.LinqaTextDim,
                ),
                navigationIcon = {
                    IconButton(onClick = onBack, modifier = Modifier.size(36.dp)) {
                        Text("←", color = com.linqa.app.ui.theme.LinqaText, fontWeight = FontWeight.SemiBold)
                    }
                },
                title = {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(conversation.title, fontWeight = FontWeight.SemiBold, color = com.linqa.app.ui.theme.LinqaText)
                            if (peerUserId != null && peerOnline) {
                                Box(
                                    modifier = Modifier
                                        .padding(start = 6.dp)
                                        .size(7.dp)
                                        .background(com.linqa.app.ui.theme.LinqaAccent, CircleShape)
                                        .border(BorderStroke(1.dp, Color(0xFF0A1B2B)), CircleShape),
                                )
                            }
                        }
                        val sub = "Local message preview" +
                            if (peerUserId != null) {
                                if (peerOnline) " · Online" else ""
                            } else {
                                " · ${conversation.participantIds.size} members"
                            }
                        Text(sub, style = MaterialTheme.typography.labelSmall, color = com.linqa.app.ui.theme.LinqaTextFaint)
                    }
                },
                actions = {
                    if (peerUserId != null && onStartCall != null) {
                        IconButton(onClick = { onStartCall(peerUserId, false) }) {
                            Icon(Icons.Rounded.Call, contentDescription = "Voice call")
                        }
                        IconButton(onClick = { onStartCall(peerUserId, true) }) {
                            Icon(Icons.Rounded.Videocam, contentDescription = "Video call")
                        }
                    }
                },
            )
        },
        bottomBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF0A1B2B))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text("Message…") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    shape = RoundedCornerShape(18.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = com.linqa.app.ui.theme.LinqaAccent,
                        unfocusedBorderColor = com.linqa.app.ui.theme.LinqaBorder,
                        focusedContainerColor = Color(0xFF102B3D),
                        unfocusedContainerColor = Color(0xFF102B3D),
                        cursorColor = com.linqa.app.ui.theme.LinqaAccent,
                        focusedTextColor = com.linqa.app.ui.theme.LinqaText,
                        unfocusedTextColor = com.linqa.app.ui.theme.LinqaText,
                        focusedPlaceholderColor = com.linqa.app.ui.theme.LinqaTextFaint,
                        unfocusedPlaceholderColor = com.linqa.app.ui.theme.LinqaTextFaint,
                    ),
                )
                FloatingActionButton(
                    onClick = { send() },
                    containerColor = com.linqa.app.ui.theme.LinqaAccent,
                    contentColor = Color(0xFF003B31),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Icon(Icons.AutoMirrored.Rounded.Send, contentDescription = "Send message", modifier = Modifier.size(18.dp))
                }
            }
        },
    ) { padding ->
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .background(com.linqa.app.ui.theme.LinqaBackground)
                .padding(padding)
                .padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (messages.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 28.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                "No messages yet",
                                color = com.linqa.app.ui.theme.LinqaText,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                "Send a quick hello to start the thread.",
                                color = com.linqa.app.ui.theme.LinqaTextFaint,
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                    }
                }
            }
            items(messages, key = { it.id }) { message ->
                MessageBubble(message)
            }
        }
    }
}

@Composable
private fun MessageBubble(message: Message) {
    val bubbleColor = if (message.isMine) Color(0xFF0C6C5B) else Color(0xFF102A3C)
    val textColor = if (message.isMine) Color.White else com.linqa.app.ui.theme.LinqaText
    val metaColor = if (message.isMine) Color(0xFFD7FFF7) else com.linqa.app.ui.theme.LinqaTextFaint

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.isMine) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 270.dp)
                .background(
                    color = bubbleColor,
                    shape = RoundedCornerShape(
                        topStart = 14.dp,
                        topEnd = 14.dp,
                        bottomStart = if (message.isMine) 14.dp else 4.dp,
                        bottomEnd = if (message.isMine) 4.dp else 14.dp,
                    ),
                )
                .padding(horizontal = 12.dp, vertical = 9.dp),
        ) {
            Column {
                Text(
                    message.text,
                    color = textColor,
                    style = MaterialTheme.typography.bodyMedium,
                )
                val meta = formatClock(message.sentAt) + if (message.isMine) "  ${STATUS_GLYPH[message.status]}" else ""
                Text(
                    meta,
                    style = MaterialTheme.typography.labelSmall,
                    color = metaColor.copy(alpha = 0.82f),
                    modifier = Modifier.padding(top = 4.dp).align(Alignment.End),
                )
            }
        }
    }
}
