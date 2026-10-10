# Linqa photo/video toggle v1.1 — matched to convo-page.jpg

This is a focused UI patch. It replaces the two stacked camera/video icons at the composer's bottom right with one selected-mode button.

Behavior:
1. Default: Video icon is visible; Photo icon is hidden.
2. Tap the visible button: popup opens above it with Photo and Video.
3. Select Photo: popup closes, camera opens in photo mode, and the composer keeps the Photo icon.
4. Select Video: popup closes, camera opens in video mode, and the composer keeps the Video icon.
5. Cancel capture: selected icon remains; neither a draft nor a message is sent.
6. Tap the button again to choose either mode. Outside tap or Android Back closes the popup without changing selection.
7. Lock/disable or account/chat switch closes the popup. Switching thread resets selection to Video.

The main button is a selector. Selecting a mode invokes capture immediately. Selection does not send the media: preview and Send still require user action. The other icon exists only in the expanded menu; no stacked icons remain in the collapsed composer.

## If using the previous composer pack
Copy ChatComposer.tsx and PhotoVideoToggle.tsx together into your existing composer components directory. Keep previous onText/onMedia connections. Use @expo/vector-icons compatible with your Expo SDK (usually already installed); if missing run `npx expo install @expo/vector-icons`. The new + attachment menu offers Choose from gallery and More attachments; More attachments calls existing onAdd. No PostgreSQL/SQLite or route changes are needed for this visual change. Previous encrypted upload integration requirements still apply.

## If retaining your existing ComposerArea
Use only PhotoVideoToggle.tsx and add:

```tsx
const [captureMode, setCaptureMode] = useState<CaptureMode>('video');

<PhotoVideoToggle
 mode={captureMode}
 onModeChange={setCaptureMode}
 onCapture={mode => onRecord(mode === 'photo' ? 'PHOTO' : 'VIDEO')}
 disabled={gate.mode !== 'LIVE' || blocked || sending}
 scopeKey={JSON.stringify([accountId,deviceId,conversationId])}
 color={theme.ink}
 surface={theme.surface}
 ink={theme.ink}
/>
```

Import PhotoVideoToggle and CaptureMode. Adapt variable names to actual ComposerArea props. Use existing onRecord/CapturePanel for capture if that path works; do not add duplicate media backends. Reset captureMode on actual scope change, not every transient rerender. The supplied screenshot shows a light composer, so use its existing theme props rather than adopting the previous indigo colors unless wanted.

The component uses real outline camera/video icons, a measured popup, outside dismissal, Android Back dismissal, and stale measurement cancellation. Parent supplies gate/block/send disablement. In existing code, ensure camera permission, photo/video handler and encrypted send are connected. Source screenshot was successfully inspected. Repo/mobile compile and physical interaction tests have not run here; this workspace has supplied text and reference files, not the current app repository.

Manual UI checks: Video -> Photo -> cancel -> Photo stays; Photo -> Video -> capture -> Video stays; outside/Back dismiss; disabled button; rotate while popup open; keyboard open; switch account/chat during popup. Verify encrypted photo/video send on receiving device separately.
