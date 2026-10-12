import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  Ack,
  C2S,
  CreateCallReq,
  DeclineCallReq,
  DeviceInfo,
  DevicesReq,
  HandoffAcceptReq,
  HandoffCancelReq,
  HandoffOfferReq,
  InviteReq,
  JoinCallReq,
  LeaveCallReq,
  SignalReq,
} from './calls.protocol';
import { AUTH_VERIFIER, AuthContext, AuthVerifier, CallEmitter } from './calls.ports';
import { CallError, CallsService } from './calls.service';

const userRoom = (u: string) => `u:${u}`;
const deviceRoom = (u: string, d: string) => `d:${u}:${d}`;

/** socket.io-backed delivery + presence. The gateway hands it the server on init. */
@Injectable()
export class SocketCallEmitter implements CallEmitter {
  server?: Server;
  /** userId -> deviceId -> { info, sockets } */
  private presence = new Map<string, Map<string, { info: DeviceInfo; sockets: number }>>();

  toUser(userId: string, event: string, payload: unknown, opts?: { exceptDeviceId?: string }): void {
    if (!this.server) return;
    let target = this.server.to(userRoom(userId));
    if (opts?.exceptDeviceId) target = target.except(deviceRoom(userId, opts.exceptDeviceId));
    target.emit(event, payload);
  }

  toDevice(userId: string, deviceId: string, event: string, payload: unknown): void {
    this.server?.to(deviceRoom(userId, deviceId)).emit(event, payload);
  }

  onlineDevices(userId: string): DeviceInfo[] {
    return [...(this.presence.get(userId)?.values() ?? [])].map((d) => d.info);
  }

  /** Returns true when this was the device's last socket. */
  track(ctx: AuthContext, delta: 1 | -1): boolean {
    let devices = this.presence.get(ctx.userId);
    if (!devices) this.presence.set(ctx.userId, (devices = new Map()));
    const entry = devices.get(ctx.deviceId) ?? {
      info: { deviceId: ctx.deviceId, name: ctx.deviceName, platform: ctx.platform },
      sockets: 0,
    };
    entry.sockets += delta;
    if (entry.sockets <= 0) {
      devices.delete(ctx.deviceId);
      if (devices.size === 0) this.presence.delete(ctx.userId);
      return true;
    }
    devices.set(ctx.deviceId, entry);
    return false;
  }
}

@WebSocketGateway({ namespace: '/calls', cors: { origin: true } })
export class CallsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger(CallsGateway.name);

  constructor(
    private readonly calls: CallsService,
    private readonly emitter: SocketCallEmitter,
    @Inject(AUTH_VERIFIER) private readonly auth: AuthVerifier,
  ) {}

  afterInit(server: Server): void {
    this.emitter.server = server;
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const a = socket.handshake.auth ?? {};
      const token = typeof a.token === 'string' ? a.token : '';
      const ctx = token
        ? await this.auth.verify(token, { deviceId: a.deviceId, deviceName: a.deviceName, platform: a.platform })
        : null;
      if (!ctx) throw new Error('unauthorized');
      socket.data.ctx = ctx;
      await socket.join([userRoom(ctx.userId), deviceRoom(ctx.userId, ctx.deviceId)]);
      this.emitter.track(ctx, 1);
      // A push may have woken this device for a call that is still ringing.
      this.calls.resendRings(ctx.userId, ctx.deviceId);
    } catch {
      socket.emit('error', { error: 'unauthorized' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    const ctx = socket.data.ctx as AuthContext | undefined;
    if (!ctx) return;
    const lastSocket = this.emitter.track(ctx, -1);
    if (lastSocket) this.calls.deviceDisconnected(ctx.userId, ctx.deviceId);
  }

  @SubscribeMessage(C2S.create)
  create(@ConnectedSocket() s: Socket, @MessageBody() b: CreateCallReq) {
    return this.run(s, (ctx) => this.calls.create(ctx, b));
  }

  @SubscribeMessage(C2S.join)
  join(@ConnectedSocket() s: Socket, @MessageBody() b: JoinCallReq) {
    return this.run(s, (ctx) => this.calls.join(ctx, b.callId));
  }

  @SubscribeMessage(C2S.decline)
  decline(@ConnectedSocket() s: Socket, @MessageBody() b: DeclineCallReq) {
    return this.run(s, (ctx) => this.calls.decline(ctx, b.callId));
  }

  @SubscribeMessage(C2S.leave)
  leave(@ConnectedSocket() s: Socket, @MessageBody() b: LeaveCallReq) {
    return this.run(s, (ctx) => this.calls.leave(ctx, b.callId));
  }

  @SubscribeMessage(C2S.signal)
  signal(@ConnectedSocket() s: Socket, @MessageBody() b: SignalReq) {
    return this.run(s, (ctx) => this.calls.signal(ctx, b));
  }

  @SubscribeMessage(C2S.invite)
  invite(@ConnectedSocket() s: Socket, @MessageBody() b: InviteReq) {
    return this.run(s, (ctx) =>
      this.calls.invite(ctx, b.callId, Array.isArray(b.userIds) ? b.userIds : [], b.keyEnvelopes),
    );
  }

  @SubscribeMessage(C2S.devices)
  devices(@ConnectedSocket() s: Socket, @MessageBody() _b: DevicesReq) {
    return this.run(s, (ctx) => this.calls.otherDevices(ctx));
  }

  @SubscribeMessage(C2S.handoffOffer)
  handoffOffer(@ConnectedSocket() s: Socket, @MessageBody() b: HandoffOfferReq) {
    return this.run(s, (ctx) => this.calls.handoffOffer(ctx, b));
  }

  @SubscribeMessage(C2S.handoffAccept)
  handoffAccept(@ConnectedSocket() s: Socket, @MessageBody() b: HandoffAcceptReq) {
    return this.run(s, (ctx) => this.calls.handoffAccept(ctx, b.callId, b.token));
  }

  @SubscribeMessage(C2S.handoffCancel)
  handoffCancel(@ConnectedSocket() s: Socket, @MessageBody() b: HandoffCancelReq) {
    return this.run(s, (ctx) => this.calls.handoffCancel(ctx, b.callId, b.token));
  }

  /** Every handler answers with an Ack so the client can await it. */
  private async run<T>(socket: Socket, fn: (ctx: AuthContext) => T | Promise<T>): Promise<Ack<T>> {
    const ctx = socket.data.ctx as AuthContext | undefined;
    if (!ctx) return { ok: false, error: 'unauthorized' };
    try {
      return { ok: true, data: await fn(ctx) };
    } catch (e) {
      if (e instanceof CallError) return { ok: false, error: e.code };
      this.log.error(e);
      return { ok: false, error: 'internal' };
    }
  }
}
