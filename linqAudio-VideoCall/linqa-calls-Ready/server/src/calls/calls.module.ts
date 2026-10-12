import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { CallsController, CallsAuthGuard } from './calls.controller';
import { CallsGateway, SocketCallEmitter } from './calls.gateway';
import {
  AUTH_VERIFIER,
  AuthVerifier,
  CALL_EMITTER,
  CONVERSATIONS_PORT,
  ConversationsPort,
  NoopRingNotifier,
  RING_NOTIFIER,
  RingNotifier,
} from './calls.ports';
import { CallsService } from './calls.service';
import { CallsStore } from './calls.store';
import { InMemoryReportsRepository, REPORTS_REPOSITORY, ReportsRepository, ReportsService } from './reports.service';
import { TurnService } from './turn.service';
import { CALLS_PRISMA } from './adapters/calls-prisma';
import { JwtCallsAuth } from './adapters/jwt-calls-auth';
import { PrismaConversationsAdapter } from './adapters/prisma-conversations.adapter';
import { PrismaReportsRepository } from './adapters/prisma-reports.repository';
import { ApnsClient } from './push/apns.client';
import { FcmClient } from './push/fcm.client';
import { PushTokensController } from './push/push-tokens.controller';
import { VoipPushNotifier } from './push/voip-push.notifier';

export interface CallsModuleOptions {
  auth: Type<AuthVerifier>;
  conversations: Type<ConversationsPort>;
  ringNotifier?: Type<RingNotifier>;
  reportsRepository?: Type<ReportsRepository>;
  /** Modules that export what the adapters above inject (e.g. your AuthModule). */
  imports?: DynamicModule['imports'];
}

/**
 * In AppModule:
 *
 *   CallsModule.forRoot({
 *     imports: [AuthModule, ConversationsModule, PushModule],
 *     auth: JwtCallsAuth,               // implements AuthVerifier
 *     conversations: ConversationsCallsAdapter,
 *     ringNotifier: VoipPushNotifier,
 *     reportsRepository: SqlReportsRepository,
 *   })
 */
@Module({})
export class CallsModule {
  static forRoot(opts: CallsModuleOptions): DynamicModule {
    const providers: Provider[] = [
      CallsStore,
      TurnService,
      CallsService,
      ReportsService,
      SocketCallEmitter,
      CallsGateway,
      CallsAuthGuard,
      { provide: CALL_EMITTER, useExisting: SocketCallEmitter },
      { provide: AUTH_VERIFIER, useClass: opts.auth },
      { provide: CONVERSATIONS_PORT, useClass: opts.conversations },
      { provide: RING_NOTIFIER, useClass: opts.ringNotifier ?? NoopRingNotifier },
      { provide: REPORTS_REPOSITORY, useClass: opts.reportsRepository ?? InMemoryReportsRepository },
    ];
    return {
      module: CallsModule,
      imports: opts.imports ?? [],
      controllers: [CallsController],
      providers,
      exports: [CallsService],
    };
  }

  /**
   * Linqa wiring: JWT auth, Prisma conversations/blocks/devices, Prisma
   * reports, and APNs VoIP + FCM ringing.
   *
   *   CallsModule.forLinqa({ imports: [PrismaModule, AuthModule], prisma: PrismaService })
   *
   * `imports` must export your PrismaService and JwtService (JwtModule).
   */
  static forLinqa(opts: { prisma: Type<unknown>; imports?: DynamicModule['imports'] }): DynamicModule {
    const base = CallsModule.forRoot({
      imports: opts.imports,
      auth: JwtCallsAuth,
      conversations: PrismaConversationsAdapter,
      ringNotifier: VoipPushNotifier,
      reportsRepository: PrismaReportsRepository,
    });
    return {
      ...base,
      controllers: [...(base.controllers ?? []), PushTokensController],
      providers: [
        ...(base.providers ?? []).filter(
          (p) => !(typeof p === 'object' && 'provide' in p && p.provide === RING_NOTIFIER),
        ),
        { provide: CALLS_PRISMA, useExisting: opts.prisma },
        ApnsClient,
        FcmClient,
        VoipPushNotifier,
        { provide: RING_NOTIFIER, useExisting: VoipPushNotifier },
      ],
    };
  }
}
