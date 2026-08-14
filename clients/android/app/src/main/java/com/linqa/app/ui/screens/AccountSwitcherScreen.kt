package com.linqa.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
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
import androidx.compose.ui.unit.sp
import com.linqa.app.network.LinkedAccount
import com.linqa.app.network.MultiAccountApi
import kotlinx.coroutines.launch

private const val MAX_ACCOUNTS = 3

@Composable
fun AccountSwitcherScreen(
    multiAccountApi: MultiAccountApi,
    activeUserId: String?,
    onBack: () -> Unit,
    onSwitched: () -> Unit,
    onAddAccount: () -> Unit,
) {
    var accounts by remember { mutableStateOf<List<LinkedAccount>?>(null) }
    var switching by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showMaxReached by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        accounts = runCatching { multiAccountApi.listAccounts() }.getOrDefault(emptyList())
    }

    val fallback = listOf(
        LinkedAccount("personal", 1, "Personal", "Jerry Diabor", "0123", "US"),
        LinkedAccount("business", 2, "Business", "Jerry Diabor", "3456", "GH"),
        LinkedAccount("research", 3, "Research", "Jerry Diabor", "0123", "GB"),
    )

    val currentAccounts = accounts ?: fallback

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .padding(horizontal = 20.dp, vertical = 24.dp),
    ) {
        Text(
            text = "Manage Accounts",
            color = Color(0xFF111827),
            fontSize = 42.sp,
            lineHeight = 48.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.padding(bottom = 16.dp),
        )

        currentAccounts.forEachIndexed { index, account ->
            val isActive = account.userId == activeUserId || index == 0
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Transparent)
                    .padding(vertical = 12.dp)
                    .clickable(enabled = switching == null && !isActive) {
                        switching = account.userId
                        error = null
                        scope.launch {
                            try {
                                multiAccountApi.switchTo(account.userId)
                                onSwitched()
                            } catch (e: Exception) {
                                error = e.message ?: "Could not switch accounts."
                            } finally {
                                switching = null
                            }
                        }
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .background(Color(0xFFB7C4D1), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(text = (account.label ?: "A").first().uppercase().toString(), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)
                }
                Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(text = account.label ?: "Account ${account.accountSlot}", color = Color(0xFF111827), fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Text(text = "+${account.countryIso2 ?: "1"} ${account.phoneSuffix ?: "202 555 0123"}", color = Color(0xFF7A8595), fontSize = 16.sp)
                    if (isActive) {
                        Text(text = if (index == 0) "Active now" else "Active 2m ago", color = Color(0xFF7A8595), fontSize = 14.sp)
                    }
                }
                if (isActive) {
                    Box(
                        modifier = Modifier
                            .background(Color(0xFFE9F7EE), RoundedCornerShape(999.dp))
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    ) {
                        Text(text = "Active", color = Color(0xFF1AA76B), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    }
                } else {
                    Text(text = ">", color = Color(0xFF7A8595), fontSize = 26.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        if (error != null) {
            Text(error ?: "", color = Color(0xFFB3261E), fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
        }

        Spacer(modifier = Modifier.height(12.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp)
                .clickable {
                    if (currentAccounts.size >= MAX_ACCOUNTS) {
                        showMaxReached = true
                    } else {
                        onAddAccount()
                    }
                }
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text = "+", color = Color(0xFF0F59D9), fontSize = 36.sp, fontWeight = FontWeight.Bold)
            Text(text = "Add Account", color = Color(0xFF0F59D9), fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
        }

        Text(
            text = "You can add up to 3 accounts",
            color = Color(0xFF7A8595),
            fontSize = 16.sp,
            modifier = Modifier.padding(top = 8.dp),
        )

        Spacer(modifier = Modifier.weight(1f))

        Button(
            onClick = { onBack() },
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F59D9)),
            shape = RoundedCornerShape(12.dp),
        ) {
            Text("Cancel", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }

        if (currentAccounts.size >= MAX_ACCOUNTS) {
            Box(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.CenterEnd) {
                Text("Maximum of 3 accounts reached", color = Color(0xFF0F59D9), fontSize = 14.sp)
            }
        }

        if (switching != null) {
            Box(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Color(0xFF0F59D9))
            }
        }
    }

    if (showMaxReached) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0x66000000)),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth(0.78f)
                    .background(Color.White, RoundedCornerShape(30.dp))
                    .padding(horizontal = 26.dp, vertical = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    modifier = Modifier
                        .size(92.dp)
                        .background(Color(0xFFD9EAFD), RoundedCornerShape(28.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(text = "◔", color = Color(0xFF0F59D9), fontSize = 42.sp, fontWeight = FontWeight.Bold)
                }

                Text(
                    text = "Maximum of 3\naccounts reached",
                    color = Color(0xFF111827),
                    fontSize = 36.sp,
                    lineHeight = 40.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.padding(top = 20.dp),
                )

                Text(
                    text = "You have reached the limit of 3\naccounts on this device.",
                    color = Color(0xFF475467),
                    fontSize = 20.sp,
                    lineHeight = 28.sp,
                    modifier = Modifier.padding(top = 10.dp, bottom = 22.dp),
                )

                Button(
                    onClick = { showMaxReached = false },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F59D9)),
                ) {
                    Text("OK", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
