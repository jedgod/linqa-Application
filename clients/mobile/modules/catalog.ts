export type LinqaModule = {
  key: string;
  title: string;
  actions: readonly string[];
};

const module = (key: string, title: string, actions: string): LinqaModule => ({
  key,
  title,
  actions: actions.split(" ")
});

export const LINQA_MODULES = [
  module("splash", "Splash", "continue sign-in create-account language accessibility"),
  module("authentication", "Authentication", "continue continue-with-passkey continue-with-google continue-with-apple continue-with-microsoft continue-with-qr-login forgot-password switch-to-phone-login switch-to-email-login verify-code resend-code voice-call-instead change-number change-email enable-passkey enable-face-id enable-fingerprint enable-pin skip"),
  module("home", "Home", "search notifications quick-create profile ai-assistant privacy-status storage-usage vpn-status send-money"),
  module("dashboard", "Dashboard", "new-chat new-call new-group share camera voice-note file-vault ai-assistant emergency-sos"),
  module("chats", "Chats", "new-message search filter unread favorites archived message-requests blocked-users business-chats communities ai-chat"),
  module("conversation", "Conversation", "back search video-call voice-call screen-share translate call-history profile menu send emoji gif sticker photo camera voice document location contact poll calendar-invite quick-payment vault-file live-location recorded-video teleprompter-video ai-rewrite ai-translate mention reaction drawing"),
  module("message-options", "Message Options", "reply reply-privately forward copy pin bookmark delete delete-for-everyone edit translate summarize ai-rewrite star export report block"),
  module("voice-calls", "Voice Calls", "mute speaker bluetooth video screen-share record transfer-call invite chat reaction end-call"),
  module("video-calls", "Video Calls", "front-camera rear-camera blur-background virtual-background portrait-mode screen-share co-watch live-captions ai-notes teleprompter recorded-message picture-in-picture mirror effects filters mute end"),
  module("screen-sharing", "Screen Sharing", "entire-screen window application pause resume stop annotation laser-pointer whiteboard remote-control"),
  module("communities", "Communities", "create-community join invite moderators announcements events files polls media members roles settings"),
  module("file-vault", "File Vault", "upload scan-document take-photo create-folder encrypt decrypt favorite share-securely offline-mode download delete recovery"),
  module("calendar", "Calendar", "create-event invite join-meeting reminder recurring video-meeting location share"),
  module("notes", "Notes", "new-note checklist drawing voice-dictation attach-file lock-note share export-pdf"),
  module("wallet", "Wallet", "cards identity passes loyalty membership qr-code scan payments add-item remove-item privacy-settings"),
  module("calls", "Calls", "audio-call video-call group-call scheduled-calls call-history missed-calls voicemail recordings transcripts live-captions call-settings"),
  module("contacts", "Contacts", "add-contact invite search favorites trusted blocked hidden sync qr-code emergency-contacts groups"),
  module("status", "Status", "create text photo video music poll location audience views reactions replies mute delete archive"),
  module("ai", "AI Assistant", "chat summarize translate rewrite suggested-replies meeting-notes action-items search reminders privacy-mode on-device confidential-cloud disabled"),
  module("search", "Search", "messages contacts files links media calls calendar notes communities global filters recent clear-history"),
  module("notifications", "Notifications", "all messages calls communities security system mentions priority mute quiet-hours mark-all-read clear settings"),
  module("privacy", "Privacy", "privacy-center last-seen profile-photo about read-receipts typing blocked-users disappearing-messages auto-delete data-export account-deletion privacy-rights"),
  module("security", "Security", "passkeys biometrics pin linked-devices active-sessions key-transparency safety-number recovery-codes security-alerts two-step-verification encryption-info audits"),
  module("linked-devices", "Linked Devices", "view add scan-qr verify rename revoke sync history-transfer alerts device-limit"),
  module("settings", "Settings", "account privacy security notifications chats calls storage accessibility ai language appearance linked-devices backup premium enterprise countrylinqa support about advanced"),
  module("advanced-settings", "Advanced Settings", "network proxy vpn relay-only diagnostics logs experimental developer reset-cache reset-settings export-diagnostics"),
  module("accessibility", "Accessibility", "font-size high-contrast reduced-motion screen-reader voice-control captions caption-size color-blind haptics sound-cues"),
  module("storage", "Storage", "usage media cache database auto-download auto-cleanup manage-downloads offline-files backup restore clear-cache"),
  module("enterprise", "Enterprise", "organization directory sso scim policies legal-holds audit-log compliance data-residency retention admin-console support"),
  module("account", "Account", "profile username phone email password passkeys sessions export delete switch-account add-account recovery"),
  module("emergency", "Emergency", "sos silent-alert emergency-contacts live-location emergency-video medical-profile escalation cancel history settings"),
  module("premium", "Premium", "plans upgrade manage-subscription storage calls ai customization priority-support business enterprise restore-purchases billing"),
  module("developer", "Developer", "runtime-status api-environment feature-flags protocol-version device-id push-token diagnostics fixtures logs reset-demo"),
  module("about", "About", "version licenses privacy-policy terms security-whitepaper protocol-documentation open-source contact-support")
] as const satisfies readonly LinqaModule[];

export function getModule(moduleKey: string): LinqaModule | undefined {
  return LINQA_MODULES.find((item) => item.key === moduleKey);
}

export function actionLabel(actionKey: string): string {
  return actionKey
    .split("-")
    .map((part) => part === "ai" ? "AI" : part === "qr" ? "QR" : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
