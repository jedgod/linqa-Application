import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CreateReportBody } from './calls.protocol';
import { AUTH_VERIFIER, AuthContext, AuthVerifier } from './calls.ports';
import { CallError, CallsService } from './calls.service';
import { ReportsService } from './reports.service';
import { TurnService } from './turn.service';

@Injectable()
export class CallsAuthGuard implements CanActivate {
  constructor(@Inject(AUTH_VERIFIER) private readonly auth: AuthVerifier) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers?.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const auth = token ? await this.auth.verify(token).catch(() => null) : null;
    if (!auth) throw new UnauthorizedException();
    req.callAuth = auth;
    return true;
  }
}

type AuthedReq = { callAuth: AuthContext };

@Controller('calls')
@UseGuards(CallsAuthGuard)
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly reports: ReportsService,
    private readonly turn: TurnService,
  ) {}

  /** Fresh ICE/TURN credentials, e.g. before an ICE restart on a long call. */
  @Get('ice-servers')
  iceServers(@Req() req: AuthedReq) {
    return { iceServers: this.turn.iceServersFor(req.callAuth.userId) };
  }

  @Get(':callId')
  info(@Req() req: AuthedReq, @Param('callId') callId: string) {
    return wrap(() => this.calls.callInfo(req.callAuth.userId, callId));
  }

  @Post(':callId/reports')
  @HttpCode(201)
  report(@Req() req: AuthedReq, @Param('callId') callId: string, @Body() body: CreateReportBody) {
    return wrap(() => this.reports.create(req.callAuth.userId, callId, body));
  }
}

async function wrap<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof CallError)) throw e;
    if (e.code === 'not-found') throw new NotFoundException();
    if (e.code === 'forbidden') throw new ForbiddenException();
    if (e.code === 'already-reported') throw new ConflictException(e.code);
    throw new BadRequestException(e.code);
  }
}
