import { Inject, Injectable } from '@nestjs/common';
import { CallReport, ReportsRepository } from '../reports.service';
import { CALLS_PRISMA, CallsPrisma } from './calls-prisma';

@Injectable()
export class PrismaReportsRepository implements ReportsRepository {
  constructor(@Inject(CALLS_PRISMA) private readonly prisma: CallsPrisma) {}

  async insert(r: CallReport): Promise<void> {
    await this.prisma.callReport.create({
      data: {
        id: r.id,
        callId: r.callId,
        conversationId: r.conversationId,
        kind: r.kind,
        reporterUserId: r.reporterUserId,
        reportedUserIds: r.reportedUserIds,
        reason: r.reason,
        note: r.note,
        callCreatedAt: new Date(r.callCreatedAt),
        callAnsweredAt: r.callAnsweredAt ? new Date(r.callAnsweredAt) : null,
        callEndedAt: r.callEndedAt ? new Date(r.callEndedAt) : null,
        participantUserIds: r.participantUserIds,
        createdAt: new Date(r.createdAt),
        status: r.status,
      },
    });
  }

  async exists(callId: string, reporterUserId: string, reportedUserId: string): Promise<boolean> {
    const n = await this.prisma.callReport.count({
      where: { callId, reporterUserId, reportedUserIds: { has: reportedUserId } },
    });
    return n > 0;
  }
}
