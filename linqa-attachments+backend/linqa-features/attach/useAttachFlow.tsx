// Connects the "+" menu to pickers and composers, and every composer to the
// one send path: files are encrypted + uploaded first, then the content
// message goes through MLS like any text. Render {flow.overlays} once on the
// conversation screen and call flow.open() from the attach button.

import React, { useCallback, useState } from "react";
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

type Composer = "poll" | "event" | "meeting" | "location" | "contact" | "voice" | "ai" | null;

interface Options {
  conversationId: string;
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
}

export function useAttachFlow(o: Options) {
  const [sheet, setSheet] = useState(false);
  const [composer, setComposer] = useState<Composer>(null);

  const sendContent = useCallback(
    async (content: MessageContent) => {
      if (!o.live) throw new Error("SECURE_CORE_UNAVAILABLE");
      await o.transport.sendContent(o.conversationId, content);
    },
    [o.live, o.transport, o.conversationId]
  );

  const sendFiles = useCallback(
    async (inputs: PrepareInput[]) => {
      for (const input of inputs) {
        const tempId = newId("up");
        try {
          o.onUploadProgress?.(tempId, 0);
          const file = await o.attachments.prepare(input, (f) => o.onUploadProgress?.(tempId, f));
          await sendContent(file);
        } catch (e) {
          Alert.alert("Not sent", e instanceof AttachmentError ? e.message : `${input.name} couldn't be sent. Try again.`);
        } finally {
          o.onUploadProgress?.(tempId, null);
        }
      }
    },
    [o.attachments, sendContent, o.onUploadProgress]
  );

  const pick = useCallback(
    async (a: AttachAction) => {
      setSheet(false);
      switch (a) {
        case "photos":
          return sendFiles(await pickPhotos());
        case "camera":
        case "video":
          return sendFiles(await takePhotoOrVideo());
        case "document":
          return sendFiles(await pickDocuments());
        case "screen":
          return o.onStartLive({ sessionId: newId("live"), screen: true });
        case "whiteboard":
          return o.onStartLive({ sessionId: newId("live"), board: true });
        default:
          setComposer(a);
      }
    },
    [sendFiles, o.onStartLive]
  );

  const done = async (content: MessageContent) => {
    await sendContent(content);
    if ((content.type === "event" || content.type === "meeting") && content.remind) {
      scheduleReminder(content, o.showNotificationPreviews).catch(() => {});
    }
    setComposer(null);
  };
  const doneFile = async (input: PrepareInput) => {
    setComposer(null);
    await sendFiles([input]);
  };
  const cancel = () => setComposer(null);

  // Returned as an element (not a component) so composers keep their state across re-renders.
  const overlays = (
    <>
      <AttachSheet
        visible={sheet}
        peerName={o.peerName}
        features={o.features}
        onPick={pick}
        onCustomize={() => (setSheet(false), o.onOpenSettings())}
        onClose={() => setSheet(false)}
      />
      <Modal visible={composer !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={cancel}>
        {composer === "poll" ? <PollComposer onSend={done} onCancel={cancel} /> : null}
        {composer === "event" ? <ScheduleComposer initialKind="Event" onSend={done} onCancel={cancel} /> : null}
        {composer === "meeting" ? <ScheduleComposer initialKind="Meeting" onSend={done} onCancel={cancel} /> : null}
        {composer === "location" ? <LocationComposer onSend={done} onCancel={cancel} /> : null}
        {composer === "contact" ? <ContactComposer onSend={done} onCancel={cancel} /> : null}
        {composer === "voice" ? <VoiceRecorder onSend={doneFile} onCancel={cancel} /> : null}
        {composer === "ai" ? (
          <AiImageComposer provider={o.aiProvider} consented={o.aiConsented} onConsent={o.onAiConsent} onSend={doneFile} onCancel={cancel} />
        ) : null}
      </Modal>
    </>
  );

  return {
    open: () => o.live && setSheet(true),
    sendContent,
    sendFiles,
    overlays,
  };
}
