// Renders a "protected_media" chat message. The key never reaches this component: it is moved into the
// device keychain when the message is decrypted (see ingestProtectedMessage), and the viewer reads it from there.

import React from 'react';
import type { ProtectedMediaContent } from '../../features/conversation/content/types';
import { ProtectedMediaBubble } from './ProtectedMediaBubble';

export function ProtectedContentBubble({ content, outgoing }: { content: ProtectedMediaContent; outgoing: boolean }) {
  return (
    <ProtectedMediaBubble
      mediaId={content.mediaId}
      mode={content.mode}
      maxViews={content.maxViews}
      windowSeconds={content.windowSeconds}
      expiryStart={content.expiryStart}
      isMine={outgoing}
    />
  );
}
