import { useState } from "react";
import type { Attachment, AttachmentKind } from "./types";
import { buildEnvelope, createAiImage, draftEvent, draftMeeting, draftPoll, vote, type ImageService, type SendContext } from "./pipeline";
import { AiImageComposer, MeetingComposer, PhotoEditor, PollComposer, ShareSheet, VoiceRecorder } from "./composers";
import { AttachmentCard, ScreenShareStage } from "./cards";

type Panel = "sheet" | "poll" | "meeting" | "voice" | "ai" | "edit" | "stage" | null;

/**
 * Attachment controller for one Linqa thread.
 * Open the sheet, run the composer, seal, append the card the thread already renders.
 */
export function AttachmentFlow({
  ctx,
  peerName,
  imageService,
}: {
  ctx: SendContext;
  peerName: string;
  imageService: ImageService;
}) {
  const [panel, setPanel] = useState<Panel>("sheet");
  const [items, setItems] = useState<Attachment[]>([]);
  const [watching, setWatching] = useState<Extract<Attachment, { kind: "screen_share" }> | null>(null);

  async function push(attachment: Attachment) {
    await buildEnvelope(ctx, attachment);
    setItems((current) => [...current, attachment]);
    setPanel(null);
  }

  function open(action: AttachmentKind | "edit_photo") {
    if (action === "edit_photo") return setPanel("edit");
    if (action === "poll") return setPanel("poll");
    if (action === "meeting" || action === "event") return setPanel("meeting");
    if (action === "voice" || action === "video") return setPanel("voice");
    if (action === "ai_image") return setPanel("ai");
    if (action === "screen_share") {
      return void push({
        kind: "screen_share",
        sessionId: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        live: true,
        presenterName: "Jerry",
        sharedTitle: "Floor plan rev C.pdf",
      });
    }
    if (action === "location") {
      return void push({
        kind: "location",
        label: "North gate, site entrance",
        address: "[STREET ADDRESS]",
        lat: 38.95,
        lng: -76.86,
      });
    }
    if (action === "contact") {
      return void push({ kind: "contact", name: "Ama Boateng", role: "Site manager", initials: "AB" });
    }
    if (action === "document") {
      return void push({ kind: "document", name: "Floor plan rev C.pdf", mime: "application/pdf", pageCount: 12, bytes: new ArrayBuffer(0) });
    }
    return void push({
      kind: "photos",
      caption: "Site photos from this morning",
      items: Array.from({ length: 7 }, (_, index) => ({
        id: `photo_${index}`,
        mime: "image/jpeg",
        width: 1200,
        height: 1600,
        bytes: new ArrayBuffer(0),
      })),
    });
  }

  return (
    <div className="linqa-flow">
      <div className="linqa-thread">
        {items.map((attachment, index) => (
          <AttachmentCard
            key={`${attachment.kind}-${index}`}
            attachment={attachment}
            timeLabel="9:40 AM"
            senderName={ctx.senderId}
            selfId={ctx.senderId}
            onVote={(option) => {
              if (attachment.kind !== "poll") return;
              const next = vote(attachment, ctx.senderId, option);
              setItems((current) => current.map((item, i) => (i === index ? next : item)));
            }}
            onWatchShare={() => {
              if (attachment.kind === "screen_share") {
                setWatching(attachment);
                setPanel("stage");
              }
            }}
          />
        ))}
      </div>

      {panel === "sheet" && (
        <ShareSheet peerName={peerName} recentThumbs={[]} onClose={() => setPanel(null)} onPick={open} />
      )}
      {panel === "poll" && (
        <PollComposer
          onCancel={() => setPanel("sheet")}
          onSend={(draft) => push(draftPoll(draft))}
        />
      )}
      {panel === "meeting" && (
        <MeetingComposer
          onCancel={() => setPanel("sheet")}
          onSend={(draft) =>
            push(
              draft.mode === "meeting"
                ? draftMeeting(draft)
                : draftEvent({
                    title: draft.title,
                    dateLabel: draft.date,
                    start: draft.starts,
                    end: "11:30 AM",
                    place: "north gate",
                    senderId: ctx.senderId,
                  }),
            )
          }
        />
      )}
      {panel === "voice" && (
        <VoiceRecorder
          onDiscard={() => setPanel("sheet")}
          onSend={(clip) =>
            push(
              clip.kind === "voice"
                ? { kind: "voice", durationSec: clip.durationSec, mime: "audio/mp4", bytes: new ArrayBuffer(0), waveform: clip.waveform }
                : { kind: "video", durationSec: clip.durationSec, mime: "video/mp4", bytes: new ArrayBuffer(0) },
            )
          }
        />
      )}
      {panel === "ai" && (
        <AiImageComposer
          peerName={peerName}
          onBack={() => setPanel("sheet")}
          onSend={async (draft) => push(await createAiImage(imageService, draft))}
        />
      )}
      {panel === "edit" && <PhotoEditor onCancel={() => setPanel("sheet")} onSend={() => push({ kind: "photos", items: [], caption: "Edited photo" })} />}
      {panel === "stage" && watching && (
        <ScreenShareStage
          presenterName={watching.presenterName}
          elapsed="4:12"
          sharedTitle={watching.sharedTitle ?? "Screen"}
          encrypted
          muted
          onLeave={() => setPanel(null)}
        />
      )}
      {panel === null && <button onClick={() => setPanel("sheet")}>Attach</button>}
    </div>
  );
}
