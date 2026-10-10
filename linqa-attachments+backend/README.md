# LinqaChat attachment and share process

Matches the share sheet and thread cards: photos, edit photo, document, location, contact, poll, event, meeting, voice, video clip, screen share, AI image.

## Send path

1. `ShareSheet` opens from the attach button. Recent photos sit above the 12 actions.
2. The chosen composer collects the card fields (poll answers and close window, meeting length and reminder, voice listen-before-send, AI style and chosen tile, crop ratio).
3. `pipeline.ts` builds the attachment.
4. AI image is the only exception: `createAiImage` sends the prompt to the image service first. The chosen bytes are what get sealed.
5. `buildEnvelope` seals the payload with the thread key (`seal.ts`, AES-GCM stand-in for the Linqa ratchet) and returns an `OutboundEnvelope`.
6. `AttachmentCard` renders the sealed attachment the way the thread shows it. Poll votes and event RSVPs update the same object.

## Wire-up

```tsx
import { AttachmentFlow } from "./linqa-attachments";

<AttachmentFlow
  peerName="Jerry"
  ctx={{ threadId, senderId, threadKey, peerName: "Jerry" }}
  imageService={{
    generate: async ({ prompt, style }) => ({
      mime: "image/png",
      bytes: new ArrayBuffer(0),
      previews: [new ArrayBuffer(0), new ArrayBuffer(0), new ArrayBuffer(0), new ArrayBuffer(0)],
    }),
  }}
/>
```

Replace `seal` / `open` with the session ratchet. Keep the exception flag: `cleartextException: "ai_prompt"` must never be set on any other kind.
