import { useEffect, useMemo, useState } from "react";
import type { Conversation } from "./types";
import { CoreBridge } from "./services/CoreBridge";
import { useSecurityRuntime } from "./hooks/useSecurityRuntime";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { SettingsPanel } from "./components/SettingsPanel";
import { SecurityStatusBanner } from "./components/SecurityStatusBanner";
import { LiveCapabilityGuard } from "./runtime/LiveCapabilityGuard";
import { CallsPage } from "./pages/CallsPage";
import { MediaGalleryPage } from "./pages/MediaGalleryPage";
import { PrivacyCenterPage } from "./pages/PrivacyCenterPage";
import { FileVaultPage } from "./pages/FileVaultPage";
import { getApiBaseUrl, getAccessToken } from "./app/apiSession";
import { hasAnyOpsScope } from "./app/opsAccess";
import { OperationsConsolePage } from "./admin/pages/OperationsConsolePage";

export function App() {
  const { state: securityState, adapter: secureAdapter } = useSecurityRuntime();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [callsOpen, setCallsOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const showOperationsEntry = hasAnyOpsScope(getAccessToken());

  useEffect(() => {
    CoreBridge.listConversations().then((list) => {
      setConversations(list);
      setActiveId((current) => current ?? list[0]?.id ?? null);
    });
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  function handleSelect(id: string) {
    setActiveId(id);
    setMobilePane("chat");
  }

  return (
    <>
      <SecurityStatusBanner state={securityState} />
      <div className="app-shell" data-mobile-pane={mobilePane}>
        <div className="app-sidebar">
          <Sidebar
            conversations={conversations}
            activeId={activeId}
            onSelect={handleSelect}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenCalls={() => setCallsOpen(true)}
            onOpenMedia={() => setMediaOpen(true)}
            onOpenPrivacy={() => setPrivacyOpen(true)}
            onOpenVault={() => setVaultOpen(true)}
            onOpenOperations={showOperationsEntry ? () => setOperationsOpen(true) : undefined}
          />
        </div>
        <div className="app-main">
          <ChatView
            conversation={activeConversation}
            securityState={securityState}
            secureAdapter={secureAdapter}
            onBack={() => setMobilePane("list")}
          />
        </div>
      </div>
      {settingsOpen && (
        <SettingsPanel securityState={securityState} onClose={() => setSettingsOpen(false)} />
      )}
      {callsOpen && (
        <div className="modal-backdrop" onClick={() => setCallsOpen(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => setCallsOpen(false)} aria-label="Close">
              ✕
            </button>
            <LiveCapabilityGuard capability="callsHistory">
              <CallsPage apiBaseUrl={getApiBaseUrl()} accessToken={getAccessToken()} />
            </LiveCapabilityGuard>
          </div>
        </div>
      )}
      {mediaOpen && (
        <div className="modal-backdrop" onClick={() => setMediaOpen(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => setMediaOpen(false)} aria-label="Close">
              ✕
            </button>
            <LiveCapabilityGuard capability="mediaGallery">
              <MediaGalleryPage apiBaseUrl={getApiBaseUrl()} accessToken={getAccessToken()} />
            </LiveCapabilityGuard>
          </div>
        </div>
      )}
      {privacyOpen && (
        <div className="modal-backdrop" onClick={() => setPrivacyOpen(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => setPrivacyOpen(false)} aria-label="Close">
              ✕
            </button>
            <LiveCapabilityGuard capability="privacyCenter">
              <PrivacyCenterPage apiBaseUrl={getApiBaseUrl()} accessToken={getAccessToken()} />
            </LiveCapabilityGuard>
          </div>
        </div>
      )}
      {vaultOpen && (
        <div className="modal-backdrop" onClick={() => setVaultOpen(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => setVaultOpen(false)} aria-label="Close">
              ✕
            </button>
            <LiveCapabilityGuard capability="fileVault">
              <FileVaultPage apiBaseUrl={getApiBaseUrl()} accessToken={getAccessToken()} />
            </LiveCapabilityGuard>
          </div>
        </div>
      )}
      {operationsOpen && (
        <div className="modal-backdrop" onClick={() => setOperationsOpen(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => setOperationsOpen(false)} aria-label="Close">
              ✕
            </button>
            <OperationsConsolePage apiBaseUrl={getApiBaseUrl()} accessToken={getAccessToken()} />
          </div>
        </div>
      )}
    </>
  );
}
