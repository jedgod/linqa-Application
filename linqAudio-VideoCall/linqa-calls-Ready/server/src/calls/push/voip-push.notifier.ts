import { Inject, Injectable, Logger } from '@nestjs/common';
import { RingNotifier } from '../calls.ports';
import { CALLS_PRISMA, CallsPrisma } from '../adapters/calls-prisma';
import { ApnsClient } from './apns.client';
import { FcmClient } from './fcm.client';

export type PushKind = 'voip' | 'fcm';

/**
 * Rings devices that may not have an open socket.
 *  - iOS: PushKit VoIP push. The app MUST report a CallKit call for every one,
 *    including cancels, or iOS stops delivering them. The native handler in
 *    modules/linqa-call-native does that.
 *  - Android: FCM data message, high priority, handled headless.
 *
 * Payloads carry ids and call kind only. No names, no keys. Apple and Google
 * see these payloads, so the app looks up the caller's name locally.
 */
@Injectable()
export class VoipPushNotifier implements RingNotifier {
  private readonly log = new Logger(VoipPushNotifier.name);

  constructor(
    @Inject(CALLS_PRISMA) private readonly prisma: CallsPrisma,
    private readonly apns: ApnsClient,
    private readonly fcm: FcmClient,
  ) {}

  async registerToken(userId: string, deviceId: string, kind: PushKind, token: string): Promise<void> {
    await this.prisma.callPushToken.upsert({
      where: { deviceId_kind: { deviceId, kind } },
      create: { userId, deviceId, kind, token },
      update: { userId, token, updatedAt: new Date() },
    });
  }

  async removeTokens(userId: string, deviceId: string): Promise<void> {
    await this.prisma.callPushToken.deleteMany({ where: { userId, deviceId } });
  }

  async ring(userId: string, deviceIds: string[], p: { callId: string; kind: string; fromUserId: string }): Promise<void> {
    if (!deviceIds.length) return;
    const rows = await this.prisma.callPushToken.findMany({ where: { userId, deviceId: { in: deviceIds } } });
    await this.send(rows, { type: 'call-ring', callId: p.callId, kind: p.kind, fromUserId: p.fromUserId });
  }

  async cancel(userId: string, callId: string): Promise<void> {
    const rows = await this.prisma.callPushToken.findMany({ where: { userId } });
    await this.send(rows, { type: 'call-cancel', callId });
  }

  private async send(rows: { deviceId: string; kind: PushKind; token: string }[], data: Record<string, string>) {
    await Promise.all(
      rows.map(async (r) => {
        try {
          const res =
            r.kind === 'voip'
              ? await this.apns.sendVoip(r.token, { linqa: data })
              : await this.fcm.sendData(r.token, data);
          if (res.unregistered) {
            await this.prisma.callPushToken.deleteMany({ where: { deviceId: r.deviceId, kind: r.kind } });
          }
        } catch (e) {
          this.log.warn(`push to ${r.deviceId} failed: ${e}`);
        }
      }),
    );
  }
}
