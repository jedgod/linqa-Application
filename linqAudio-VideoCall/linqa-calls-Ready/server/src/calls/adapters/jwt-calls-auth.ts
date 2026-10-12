import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthContext, AuthVerifier, DeviceClaim } from '../calls.ports';
import { CALLS_PRISMA, CallsPrisma } from './calls-prisma';

const PLATFORMS = new Set(['ios', 'android', 'desktop', 'web']);

/**
 * Verifies the same JWT the rest of the Linqa API issues, then checks that
 * the device id sent alongside it is a live device of that user.
 * The user id is read from `sub` (or `userId` if that is what you sign).
 */
@Injectable()
export class JwtCallsAuth implements AuthVerifier {
  constructor(
    private readonly jwt: JwtService,
    @Inject(CALLS_PRISMA) private readonly prisma: CallsPrisma,
  ) {}

  async verify(token: string, claim: DeviceClaim): Promise<AuthContext | null> {
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      return null;
    }
    const userId = typeof payload.user_id === 'string' ? payload.user_id : '';
    const signedDeviceId = typeof payload.device_id === 'string' ? payload.device_id : '';
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
    if (!scopes.includes('calls:write') || !signedDeviceId) return null;
    const deviceId = typeof claim.deviceId === 'string' ? claim.deviceId.slice(0, 128) : '';
    if (!userId || !deviceId || deviceId !== signedDeviceId) return null;

    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId, revokedAt: null },
      select: { id: true, name: true, platform: true },
    });
    if (!device) return null;

    const platform = String(device.platform ?? claim.platform ?? '').toLowerCase();
    return {
      userId,
      deviceId,
      deviceName: String(device.name ?? claim.deviceName ?? 'Device').slice(0, 64),
      platform: (PLATFORMS.has(platform) ? platform : 'unknown') as AuthContext['platform'],
    };
  }
}
