// Real-time alerts to the sender (viewed, screenshot, expired, ...).
// Delivered over Server-Sent Events while the sender's app is open.
// Hook your push service into `push()` so alerts also arrive when it is closed.

import { Injectable, Logger } from '@nestjs/common';
import { Subject, filter, map, type Observable } from 'rxjs';

export type SenderAlertType =
  | 'VIEWED'
  | 'SCREENSHOT'
  | 'SCREEN_RECORDING'
  | 'EXHAUSTED'
  | 'EXPIRED'
  | 'CAPTURE_REVOKED';

export type SenderAlert = {
  type: SenderAlertType;
  mediaId: string;
  conversationId: string | null;
  viewNumber?: number | null;
  remainingViews?: number | null;
  at: string;
};

@Injectable()
export class MediaEventsService {
  private readonly log = new Logger(MediaEventsService.name);
  private readonly bus = new Subject<{ userId: string; alert: SenderAlert }>();

  emit(userId: string, alert: SenderAlert) {
    this.bus.next({ userId, alert });
    void this.push(userId, alert);
  }

  /** Stream for one user, shaped for Nest's @Sse(). */
  streamFor(userId: string): Observable<{ data: SenderAlert; type: string }> {
    return this.bus.pipe(
      filter((e) => e.userId === userId),
      map((e) => ({ data: e.alert, type: 'protected-media' })),
    );
  }

  /**
   * TODO: send a push notification through your existing push setup
   * (for example Expo push tokens). Keep the text generic, e.g.
   * "Your photo was viewed", and never include image data.
   */
  private async push(userId: string, alert: SenderAlert): Promise<void> {
    this.log.debug(`alert ${alert.type} for ${userId} on ${alert.mediaId}`);
  }
}
