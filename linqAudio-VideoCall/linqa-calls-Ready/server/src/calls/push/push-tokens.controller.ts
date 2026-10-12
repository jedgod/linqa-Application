import { BadRequestException, Body, Controller, Delete, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { CallsAuthGuard } from '../calls.controller';
import { AuthContext } from '../calls.ports';
import { PushKind, VoipPushNotifier } from './voip-push.notifier';

/**
 * The app registers its PushKit (iOS) or FCM (Android) token for this device.
 *   POST   /calls/push-tokens  { kind: "voip" | "fcm", token }
 *   DELETE /calls/push-tokens  (on sign-out)
 */
@Controller('calls/push-tokens')
@UseGuards(CallsAuthGuard)
export class PushTokensController {
  constructor(private readonly push: VoipPushNotifier) {}

  @Post()
  @HttpCode(204)
  async register(@Req() req: { callAuth: AuthContext }, @Body() body: { kind?: string; token?: string }) {
    const kind = body?.kind as PushKind;
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if ((kind !== 'voip' && kind !== 'fcm') || !token || token.length > 4096) throw new BadRequestException('bad-token');
    if (kind === 'voip' && !/^[0-9a-fA-F]{32,200}$/.test(token)) throw new BadRequestException('bad-token');
    await this.push.registerToken(req.callAuth.userId, req.callAuth.deviceId, kind, token);
  }

  @Delete()
  @HttpCode(204)
  async remove(@Req() req: { callAuth: AuthContext }) {
    await this.push.removeTokens(req.callAuth.userId, req.callAuth.deviceId);
  }
}
