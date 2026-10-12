import { Inject, Injectable } from '@nestjs/common';
import { ConversationsPort } from '../calls.ports';
import { CALLS_PRISMA, CallsPrisma } from './calls-prisma';

@Injectable()
export class PrismaConversationsAdapter implements ConversationsPort {
  constructor(@Inject(CALLS_PRISMA) private readonly prisma: CallsPrisma) {}

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    return (await this.prisma.conversationMember.count({ where: { conversationId, userId } })) > 0;
  }

  /**
   * You can call someone if neither of you has blocked the other and you
   * share at least one conversation (that's how Add person finds contacts).
   */
  async canCall(fromUserId: string, toUserId: string): Promise<boolean> {
    if (fromUserId === toUserId) return false;
    const blocked = await this.prisma.block.count({
      where: {
        OR: [
          { blockerId: fromUserId, blockedId: toUserId },
          { blockerId: toUserId, blockedId: fromUserId },
        ],
      },
    });
    if (blocked > 0) return false;
    const shared = await this.prisma.conversationMember.count({
      where: {
        userId: toUserId,
        conversation: { members: { some: { userId: fromUserId } } },
      },
    });
    return shared > 0;
  }
}
