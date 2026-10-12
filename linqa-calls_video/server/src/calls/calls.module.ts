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
}
