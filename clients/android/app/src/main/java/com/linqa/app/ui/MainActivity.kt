package com.linqa.app.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.linqa.app.BuildConfig
import com.linqa.app.account.InstallationIdentity
import com.linqa.app.auth.SessionStore
import com.linqa.app.calls.CallForegroundService
import com.linqa.app.calls.CallSession
import com.linqa.app.calls.CallState
import com.linqa.app.calls.RemoteTrackEvent
import com.linqa.app.crypto.CoreBridge
import com.linqa.app.crypto.DeviceIdentity
import com.linqa.app.crypto.NativeCore
import com.linqa.app.crypto.SignalingCrypto
import com.linqa.app.model.Conversation
import com.linqa.app.model.HubSnapshot
import com.linqa.app.network.AuthApi
import com.linqa.app.network.CallsApi
import com.linqa.app.messages.E2eeMessageRepository
import com.linqa.app.network.EnrollmentApi
import com.linqa.app.network.EnvelopeApi
import com.linqa.app.network.KeyPackageApi
import com.linqa.app.network.MultiAccountApi
import com.linqa.app.network.RealApiClient
import com.linqa.app.network.RecoveryEmailApi
import com.linqa.app.network.CountryLinqaApi
import com.linqa.app.ui.screens.AccountCreatedScreen
import com.linqa.app.ui.screens.AccountSwitcherScreen
import com.linqa.app.ui.screens.CallScreen
import com.linqa.app.ui.screens.CarrierCheckScreen
import com.linqa.app.ui.screens.ChatScreen
import com.linqa.app.ui.screens.ConversationListScreen
import com.linqa.app.ui.screens.CountryDiscoverySettingsScreen
import com.linqa.app.ui.screens.CountryLinqaListScreen
import com.linqa.app.ui.screens.CountryPickerScreen
import com.linqa.app.ui.screens.DeviceEnrollmentScreen
import com.linqa.app.ui.screens.LinqaWorldScreen
import com.linqa.app.ui.screens.LoginScreen
import com.linqa.app.ui.screens.MultiAccountPhoneVerifyScreen
import com.linqa.app.ui.screens.OtpVerifyScreen
import com.linqa.app.ui.screens.RecoveryEmailScreen
import com.linqa.app.ui.screens.RegionPickerScreen
import com.linqa.app.ui.screens.SettingsScreen
import com.linqa.app.ui.theme.LinqaBackground
import com.linqa.app.ui.theme.LinqaTheme
import kotlinx.coroutines.launch
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
import org.webrtc.EglBase

private sealed interface Screen {
    data object Login : Screen
    data class CarrierCheck(val identifier: String, val challengeId: String) : Screen
    data class OtpVerify(val identifier: String, val challengeId: String) : Screen
    data object AccountCreated : Screen
    data object Enrolling : Screen
    data object ConversationList : Screen
    data class Chat(val conversation: Conversation) : Screen
    data object Settings : Screen
    data object RecoveryEmail : Screen
    data object CountryDiscoverySettings : Screen
    data object LinqaWorld : Screen
    data object CountryPicker : Screen
    data object RegionPicker : Screen
    data class CountryLinqaList(val kind: String) : Screen
    data object AccountSwitcher : Screen
    data object MultiAccountPhoneVerify : Screen
    data class Call(val peerName: String, val video: Boolean) : Screen
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            LinqaTheme {
                Surface(modifier = Modifier.fillMaxSize().background(LinqaBackground)) {
                    LinqaApp()
                }
            }
        }
    }
}

@Composable
private fun LinqaApp() {
    val context = LocalContext.current
    val sessionStore = remember { SessionStore(context) }
    val deviceIdentity = remember { DeviceIdentity(context) }
    val realApi = remember {
        RealApiClient(BuildConfig.API_BASE_URL, sessionStore).also { api ->
            CoreBridge.configureAuthenticatedClient(api) { sessionStore.current()?.accessToken }
        }
    }
    val authApi = remember { AuthApi(realApi, sessionStore) }
    val enrollmentApi = remember { EnrollmentApi(realApi, sessionStore, deviceIdentity) }
    val keyPackageApi = remember { KeyPackageApi(realApi, sessionStore) }
    val envelopeApi = remember { EnvelopeApi(realApi) }
    val messageRepository = remember { E2eeMessageRepository(sessionStore, keyPackageApi, envelopeApi) }
    val callsApi = remember { CallsApi(realApi) }
    val recoveryEmailApi = remember { RecoveryEmailApi(realApi) }
    val countryLinqaApi = remember { CountryLinqaApi(realApi) }
    val installationIdentity = remember { InstallationIdentity(context) }
    val multiAccountApi = remember { MultiAccountApi(realApi, sessionStore, installationIdentity) }
    val signalingCrypto = remember { SignalingCrypto(deviceIdentity) }
    val eglBase = remember { EglBase.create() }

    var callSession by remember { mutableStateOf<CallSession?>(null) }
    var callState by remember { mutableStateOf(CallState.IDLE) }
    var remoteTrack by remember { mutableStateOf<RemoteTrackEvent?>(null) }

    var screen by remember {
        mutableStateOf<Screen>(
            when {
                sessionStore.isEnrolled() -> Screen.ConversationList
                sessionStore.current() != null -> Screen.Enrolling
                else -> Screen.Login
            }
        )
    }
    var addingAccount by remember { mutableStateOf(false) }
    var hub by remember { mutableStateOf<HubSnapshot?>(null) }
    var conversationsLoading by remember { mutableStateOf(true) }
    var hubError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun refreshHub() {
        try {
            hub = CoreBridge.loadHub()
            hubError = null
        } catch (_: Exception) {
            hubError = "Live service unavailable"
        } finally {
            conversationsLoading = false
        }
    }

    LaunchedEffect(screen) {
        if (sessionStore.current() != null) refreshHub()
    }

    DisposableEffect(screen, sessionStore.current()?.userId) {
        val socket = if (sessionStore.current() != null) {
            runCatching { CoreBridge.connectRealtime { scope.launch { refreshHub() } } }.getOrNull()
        } else null
        onDispose { socket?.close(1000, "screen disposed") }
    }

    fun endActiveCall() {
        callSession?.endCall()
        callSession = null
        context.stopService(Intent(context, CallForegroundService::class.java))
    }

    fun startCall(peerUserId: String, peerName: String, video: Boolean) {
        scope.launch {
            val resolved = runCatching { keyPackageApi.resolveDevice(peerUserId) }.getOrNull()
                ?: return@launch

            callState = CallState.IDLE
            remoteTrack = null
            val session = CallSession(
                context = context,
                eglBase = eglBase,
                callsApi = callsApi,
                signalingBaseUrl = BuildConfig.API_BASE_URL,
                sessions = sessionStore,
                signalingCrypto = signalingCrypto,
                onStateChange = { state ->
                    callState = state
                    if (state == CallState.ENDED || state == CallState.FAILED) {
                        context.stopService(Intent(context, CallForegroundService::class.java))
                    }
                },
                onRemoteTrack = { track -> remoteTrack = track },
            )
            callSession = session
            context.startService(Intent(context, CallForegroundService::class.java))
            session.startOutgoingCall(
                recipientUserId = peerUserId,
                recipientDeviceId = resolved.deviceId,
                recipientPublicKey = resolved.encryptionPublicKey,
                video = video,
            )
            screen = Screen.Call(peerName, video)
        }
    }

    BackHandler(enabled = screen != Screen.ConversationList && screen != Screen.Login) {
        if (screen is Screen.Call) endActiveCall()
        screen = Screen.ConversationList
    }

    when (val current = screen) {
        is Screen.Login -> LoginScreen(
            authApi = authApi,
            onCodeSent = { identifier, challengeId ->
                screen = Screen.CarrierCheck(identifier, challengeId)
            },
        )
        is Screen.CarrierCheck -> CarrierCheckScreen(
            onDone = { screen = Screen.OtpVerify(current.identifier, current.challengeId) },
        )
        is Screen.OtpVerify -> OtpVerifyScreen(
            authApi = authApi,
            identifier = current.identifier,
            challengeId = current.challengeId,
            onVerified = {
                screen = if (addingAccount) Screen.MultiAccountPhoneVerify else Screen.AccountCreated
            },
            onBack = {
                val wasAddingAccount = addingAccount
                addingAccount = false
                screen = if (wasAddingAccount) Screen.AccountSwitcher else Screen.Login
            },
        )
        is Screen.AccountCreated -> AccountCreatedScreen(
            onContinue = {
                screen = if (addingAccount) {
                    addingAccount = false
                    Screen.AccountSwitcher
                } else {
                    Screen.Enrolling
                }
            },
        )
        is Screen.Enrolling -> DeviceEnrollmentScreen(
            enrollmentApi = enrollmentApi,
            keyPackageApi = keyPackageApi,
            onEnrolled = { screen = Screen.ConversationList },
        )
        is Screen.ConversationList -> ConversationListScreen(
            hub = hub,
            isLoading = conversationsLoading,
            errorMessage = hubError,
            onSelect = { screen = Screen.Chat(it) },
            onOpenSettings = { screen = Screen.Settings },
            onPublishStatus = { body ->
                scope.launch {
                    runCatching { CoreBridge.publishStatus(body) }
                    refreshHub()
                }
            },
            onStartConversation = { contact ->
                scope.launch {
                    val id = runCatching { CoreBridge.createConversation(contact.id) }.getOrNull()
                    refreshHub()
                    hub?.conversations?.find { it.id == id }?.let { screen = Screen.Chat(it) }
                }
            },
            onStartCall = { contact ->
                scope.launch {
                    runCatching { CoreBridge.createCall(contact.id) }
                    refreshHub()
                }
            },
        )
        is Screen.Chat -> ChatScreen(
            conversation = current.conversation,
            peerOnline = current.conversation.participantIds.firstOrNull()?.let { peerId ->
                hub?.contacts?.find { it.id == peerId }?.online
            } ?: false,
            onBack = { screen = Screen.ConversationList },
            onStartCall = { peerUserId, video ->
                startCall(peerUserId, current.conversation.title, video)
            },
            messageRepository = if (NativeCore.isLoaded()) messageRepository else null,
        )
        is Screen.Settings -> SettingsScreen(
            onBack = { screen = Screen.ConversationList },
            onAddRecoveryEmail = { screen = Screen.RecoveryEmail },
            onOpenDiscovery = { screen = Screen.CountryDiscoverySettings },
            onOpenLinqaWorld = { screen = Screen.LinqaWorld },
            onOpenAccountSwitcher = { screen = Screen.AccountSwitcher },
        )
        is Screen.AccountSwitcher -> AccountSwitcherScreen(
            multiAccountApi = multiAccountApi,
            activeUserId = sessionStore.current()?.userId,
            onBack = { screen = Screen.Settings },
            onSwitched = {
                screen = Screen.ConversationList
                scope.launch { refreshHub() }
            },
            onAddAccount = {
                addingAccount = true
                screen = Screen.Login
            },
        )
        is Screen.MultiAccountPhoneVerify -> MultiAccountPhoneVerifyScreen(
            multiAccountApi = multiAccountApi,
            onVerified = {
                scope.launch {
                    runCatching { multiAccountApi.addCurrentAccount() }
                    addingAccount = false
                    screen = Screen.ConversationList
                    refreshHub()
                }
            },
            onBack = {
                addingAccount = false
                screen = Screen.AccountSwitcher
            },
        )
        is Screen.RecoveryEmail -> RecoveryEmailScreen(
            recoveryEmailApi = recoveryEmailApi,
            onLinked = { screen = Screen.Settings },
            onBack = { screen = Screen.Settings },
        )
        is Screen.CountryDiscoverySettings -> CountryDiscoverySettingsScreen(
            countryLinqaApi = countryLinqaApi,
            onBack = { screen = Screen.Settings },
            onOpenCountryPicker = { screen = Screen.CountryPicker },
            onOpenRegionPicker = { screen = Screen.RegionPicker },
        )
        is Screen.CountryPicker -> CountryPickerScreen(
            countryLinqaApi = countryLinqaApi,
            onBack = { screen = Screen.LinqaWorld },
            onDone = { screen = Screen.LinqaWorld },
        )
        is Screen.RegionPicker -> RegionPickerScreen(
            countryLinqaApi = countryLinqaApi,
            onBack = { screen = Screen.LinqaWorld },
            onDone = { screen = Screen.LinqaWorld },
        )
        is Screen.LinqaWorld -> LinqaWorldScreen(
            countryLinqaApi = countryLinqaApi,
            onBack = { screen = Screen.ConversationList },
            onOpenFeed = { screen = Screen.CountryLinqaList("feed") },
            onOpenPeople = { screen = Screen.CountryLinqaList("people") },
            onOpenBusinesses = { screen = Screen.CountryLinqaList("businesses") },
            onOpenEvents = { screen = Screen.CountryLinqaList("events") },
            onOpenCommunities = { screen = Screen.CountryLinqaList("communities") },
            onOpenCountries = { screen = Screen.CountryPicker },
            onOpenRegions = { screen = Screen.RegionPicker },
        )
        is Screen.CountryLinqaList -> when (current.kind) {
            "feed" -> CountryLinqaListScreen(
                title = "World Feed",
                emptyLabel = "No posts in your discovery scope yet.",
                onBack = { screen = Screen.LinqaWorld },
                load = { countryLinqaApi.golivefeed().getJSONArray("items").let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } },
                primaryField = "body",
                secondaryField = "countryCode",
            )
            "people" -> CountryLinqaListScreen(
                title = "People",
                emptyLabel = "No one matches your discovery scope yet.",
                onBack = { screen = Screen.LinqaWorld },
                load = { emptyList() },
                primaryField = "display_name",
            )
            "businesses" -> CountryLinqaListScreen(
                title = "Businesses",
                emptyLabel = "No businesses in your discovery scope yet.",
                onBack = { screen = Screen.LinqaWorld },
                load = { countryLinqaApi.golivebusinesses().getJSONArray("items").let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } },
                primaryField = "name",
                secondaryField = "category",
            )
            "events" -> CountryLinqaListScreen(
                title = "Events",
                emptyLabel = "No upcoming events in your discovery scope yet.",
                onBack = { screen = Screen.LinqaWorld },
                load = { countryLinqaApi.goliveevents().getJSONArray("items").let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } },
                primaryField = "title",
                secondaryField = "city",
            )
            else -> CountryLinqaListScreen(
                title = "Communities",
                emptyLabel = "You haven't joined any country communities yet.",
                onBack = { screen = Screen.LinqaWorld },
                load = { countryLinqaApi.communitiesMine().getJSONArray("items").let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } },
                primaryField = "name",
                secondaryField = "membershipType",
            )
        }
        is Screen.Call -> callSession?.let { session ->
            CallScreen(
                session = session,
                eglBase = eglBase,
                peerName = current.peerName,
                video = current.video,
                state = callState,
                remoteTrack = remoteTrack,
                onEnd = {
                    endActiveCall()
                    screen = Screen.ConversationList
                },
            )
        }
    }
}
