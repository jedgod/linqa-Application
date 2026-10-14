// Connects the "+" menu to pickers and composers, and every composer to the
// one send path: files are encrypted + uploaded first, then the content
// message goes through MLS like any text. Render {flow.overlays} once on the
// conversation screen and call flow.open() from the attach button.

import { ModalSafe } from "../../../components/common/ModalSafe";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Modal } from "react-native";
import { AttachAction, AttachSheet, ChatFeatures } from "./AttachSheet";
import { AttachmentError, AttachmentService, PrepareInput } from "../attachments/AttachmentService";
import { pickDocuments, pickPhotos, takePhotoOrVideo } from "../attachments/pickers";
import { ContentTransport, MessageContent } from "../content/types";
import { PollComposer } from "../features/polls/Poll";
import { ScheduleComposer } from "../features/schedule/Schedule";
import { scheduleReminder } from "../features/schedule/calendar";
import { LocationComposer } from "../features/location/Location";
import { ContactComposer } from "../features/contact/Contact";
import { AiImageComposer, AiImageProvider } from "../features/ai/AiImage";
import { VoiceRecorder } from "../features/voice/Voice";
import { newId } from "../content/codec";
import { ProtectedPhotoComposer } from "../../../components/protected/ProtectedPhotoComposer";

type Composer = "protected" | "poll" | "event" | "meeting" | "location" | "contact" | "voice" | "ai" | null;

interface Options {
  conversationId: string;
  /** The other person in a one-to-one chat. Protected photos need exactly one recipient. */
  peerId?: string | null;
  peerName: string;
  features: ChatFeatures;
  /** False while the messaging gate is LOCKED: nothing can be sent. */
  live: boolean;
  transport: ContentTransport;
  attachments: AttachmentService;
  aiProvider: AiImageProvider;
  aiConsented: boolean;
  onAiConsent: () => void;
  showNotificationPreviews: boolean;
  onOpenSettings: () => void;
  /** Start a call; `screen` asks to share right away, `board` opens the whiteboard. */
  onStartLive: (opts: { sessionId: string; screen?: boolean; board?: boolean }) => void;
  /** For upload progress UI in the thread. */
  onUploadProgress?: (tempId: string, fraction: number | null) => void;
  allowedActions?: AttachAction[];
  onCapture?: (kind: "VOICE" | "VIDEO" | "PHOTO" | "GALLERY" | "DESIGN") => void;
}

export function useAttachFlow(o: Options) {
  const [sheet, setSheet] = useState(false);
  const [composer, setComposer] = useState<Composer>(null);
  const liveRef = useRef(o.live); liveRef.current = o.live;
  const uploading = useRef(false);
  useEffect(() => { if (!o.live) { setSheet(false); setComposer(null); } }, [o.live]);

  const sendContent = useCallback(
    async (content: MessageContent) => {
      if (!liveRef.current) throw new Error("SECURE_CORE_UNAVAILABLE");
      await o.transport.sendContent(o.conversationId, content);
    },
    [o.live, o.transport, o.conversationId]
  );

  const sendFiles = useCallback(
    async (inputs: PrepareInput[]) => {
      if (!liveRef.current) throw new Error("SECURE_CORE_UNAVAILABLE");
      if (uploading.current) throw new Error("UPLOAD_IN_PROGRESS");
      uploading.current = true;
      try {
      for (const input of inputs) {
        const tempId = newId("up");
        try {
          o.onUploadProgress?.(tempId, 0);
          const file = await o.attachments.prepare(input, (f) => o.onUploadProgress?.(tempId, f));
          await sendContent(file);
        } catch (e) {
          throw e;
        } finally {
          o.onUploadProgress?.(tempId, null);
        }
      }
      } finally { uploading.current = false; }
    },
    [o.attachments, sendContent, o.onUploadProgress]
  );

  // A system picker that was dismissed without choosing anything leads back to the "Share with" sheet.
  const sendOrReopen = useCallback(async (inputs: PrepareInput[]) => {
    if (!inputs.length) { if (liveRef.current) setSheet(true); return; }
    await sendFiles(inputs);
  }, [sendFiles]);

  const pick = useCallback(
    async (a: AttachAction) => {
      if (!liveRef.current || (o.allowedActions && !o.allowedActions.includes(a))) return;
      setSheet(false);
      if (o.onCapture && ["photos", "camera", "video", "voice", "design"].includes(a)) return o.onCapture(a === "photos" ? "GALLERY" : a === "camera" ? "PHOTO" : a === "video" ? "VIDEO" : a === "design" ? "DESIGN" : "VOICE");
      switch (a) {
        case "photos":
          return sendOrReopen(await pickPhotos());
        case "camera":
        case "video":
          return sendOrReopen(await takePhotoOrVideo());
        case "document":
          return sendOrReopen(await pickDocuments());
        case "design":
          return sendOrReopen(await pickPhotos());
        case "screen":
          return o.onStartLive({ sessionId: newId("live"), screen: true });
        case "whiteboard":
          return o.onStartLive({ sessionId: newId("live"), board: true });
        default:
          setComposer(a);
      }
    },
    [sendFiles, sendOrReopen, o.onStartLive, o.onCapture, o.allowedActions]
  );

  const done = async (content: MessageContent) => {
    await sendContent(content);
    if ((content.type === "event" || content.type === "meeting") && content.remind) {
      scheduleReminder(content, o.showNotificationPreviews).catch(() => {});
    }
    setComposer(null);
  };
  const doneFile = async (input: PrepareInput) => {
    await sendFiles([input]);
    setComposer(null);
  };
  // Leaving a page without sending (Cancel, Back, the system back button) returns to the "Share with" sheet it was opened from.
  // Reopened a moment after the page above it has finished closing: two sheets changing at once can drop the second one.
  const reopenSheet = useCallback(() => { setTimeout(() => { if (liveRef.current) setSheet(true); }, 350); }, []);
  const cancel = () => { setComposer(null); reopenSheet(); };
  const sentProtected = useRef(false);

  // Returned as an element (not a component) so composers keep their state across re-renders.
  const overlays = (
    <>
      <AttachSheet
        visible={sheet}
        peerName={o.peerName}
        features={o.features}
        allowedActions={o.allowedActions}
        onPick={a => { void pick(a).catch(() => Alert.alert("Not sent", "The attachment couldn't be sent. Check your connection and try again.")); }}
        onCustomize={() => (setSheet(false), o.onOpenSettings())}
        onClose={() => setSheet(false)}
      />
      {o.peerId ? (
        <ProtectedPhotoComposer
          visible={composer === "protected"}
          recipientId={o.peerId}
          conversationId={o.conversationId}
          onSent={async (payload) => { await sendContent(payload); sentProtected.current = true; }}
          onClose={() => { if (sentProtected.current) { sentProtected.current = false; setComposer(null); } else cancel(); }}
        />
      ) : null}
      <Modal visible={composer !== null && composer !== "protected"} animationType="slide" presentationStyle="fullScreen" onRequestClose={cancel} navigationBarTranslucent>
        <ModalSafe>
        {composer === "poll" ? <PollComposer onSend={done} onCancel={cancel} /> : null}
        {composer === "event" ? <ScheduleComposer initialKind="Event" onSend={done} onCancel={cancel} /> : null}
        {composer === "meeting" ? <ScheduleComposer initialKind="Meeting" onSend={done} onCancel={cancel} /> : null}
        {composer === "location" ? <LocationComposer onSend={done} onCancel={cancel} /> : null}
        {composer === "contact" ? <ContactComposer onSend={done} onCancel={cancel} /> : null}
        {composer === "voice" ? <VoiceRecorder onSend={doneFile} onCancel={cancel} /> : null}
        {composer === "ai" ? (
          <AiImageComposer provider={o.aiProvider} consented={o.aiConsented} onConsent={o.onAiConsent} onSend={doneFile} onCancel={cancel} />
        ) : null}
        </ModalSafe>
      </Modal>
    </>
  );

  return {
    open: () => o.live && setSheet(true),
    reopen: reopenSheet,
    pickAction: (action: AttachAction) => pick(action),
    sendContent,
    sendFiles,
    overlays,
  };
}
