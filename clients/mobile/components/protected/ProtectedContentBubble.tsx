// Renders a "protected_media" chat message. The recipient's copy of the key is moved into the
// device keychain as soon as the message is shown, and the viewer reads it from there.

import React, { useEffect } from 'react';
import type { ProtectedMediaContent } from '../../features/conversation/content/types';
import { rememberMediaKey } from '../../lib/protectedMedia/keyStore';
import { ProtectedMediaBubble } from './ProtectedMediaBubble';

export function ProtectedContentBubble({ content, outgoing }: { content: ProtectedMediaContent; outgoing: boolean }) {
  useEffect(() => {
    if (!outgoing) void rememberMediaKey(content.mediaId, content.secret).catch(() => undefined);
  }, [outgoing, content.mediaId, content.secret]);

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
