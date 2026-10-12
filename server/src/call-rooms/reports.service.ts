import { randomUUID } from 'crypto';
import { CreateReportBody, LIMITS, REPORT_REASONS, ReportReason } from './calls.protocol.js';
import { CallError, CallsService } from './calls.service.js';

/**
 * Calls are end-to-end encrypted, so a report carries metadata only:
 * who, when, how long, what reason, and the reporter's own note.
 * There is no recording and the server has no media to attach.
 */
export interface CallReport {
  id: string;
  callId: string;
  conversationId: string;
  kind: 'voice' | 'video';
  reporterUserId: string;
  reportedUserIds: string[];
  reason: ReportReason;
  note: string | null;
  callCreatedAt: number;
  callAnsweredAt: number | null;
  callEndedAt: number | null;
  participantUserIds: string[];
  createdAt: number;
  status: 'open' | 'actioned' | 'dismissed';
}

export const REPORTS_REPOSITORY = Symbol('REPORTS_REPOSITORY');
export interface ReportsRepository {
  insert(r: CallReport): Promise<void>;
  exists(callId: string, reporterUserId: string, reportedUserId: string): Promise<boolean>;
}

/** Dev default. Bind REPORTS_REPOSITORY to a SQL repo (see migrations/) in production. */
export class InMemoryReportsRepository implements ReportsRepository {
  readonly rows: CallReport[] = [];
  async insert(r: CallReport) {
    this.rows.push(r);
  }
  async exists(callId: string, reporter: string, reported: string) {
    return this.rows.some(
      (r) => r.callId === callId && r.reporterUserId === reporter && r.reportedUserIds.includes(reported),
    );
  }
}

export class ReportsService {
  constructor(
    private readonly calls: CallsService,
    private readonly repo: ReportsRepository,
  ) {}

  async create(reporterUserId: string, callId: string, body: CreateReportBody): Promise<{ id: string }> {
    const call = this.calls.getRecord(callId);
    if (!call || !call.everJoined.has(reporterUserId)) throw new CallError('not-found');

    if (!REPORT_REASONS.includes(body?.reason)) throw new CallError('bad-reason');
    const reported = [...new Set(Array.isArray(body.reportedUserIds) ? body.reportedUserIds : [])].filter(
      (u) => u !== reporterUserId,
    );
    if (reported.length === 0) throw new CallError('no-one-reported');
    for (const u of reported) {
      if (!call.everJoined.has(u) && !call.everInvited.has(u)) throw new CallError('user-not-in-call');
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, LIMITS.reportNoteMax) : '';

    const fresh: string[] = [];
    for (const u of reported) if (!(await this.repo.exists(callId, reporterUserId, u))) fresh.push(u);
    if (fresh.length === 0) throw new CallError('already-reported');

    const report: CallReport = {
      id: randomUUID(),
      callId,
      conversationId: call.conversationId,
      kind: call.kind,
      reporterUserId,
      reportedUserIds: fresh,
      reason: body.reason,
      note: note || null,
      callCreatedAt: call.createdAt,
      callAnsweredAt: call.answeredAt,
      callEndedAt: call.endedAt,
      participantUserIds: [...call.everJoined],
      createdAt: Date.now(),
      status: 'open',
    };
    await this.repo.insert(report);
    return { id: report.id };
  }
}
