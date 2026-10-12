/**
 * The Prisma calls the call adapters make, in one place.
 *
 * EXISTING Linqa models these assume (rename here if yours differ):
 *   ConversationMember { conversationId, userId }
 *   Block              { blockerId, blockedId }
 *   Device             { id, userId, name, platform, revokedAt? }
 *
 * NEW models added by prisma/calls.prisma:
 *   CallReport, CallPushToken
 *
 * Typed structurally so this module compiles without your generated client;
 * your PrismaService satisfies it as long as the model names match.
 */
export const CALLS_PRISMA = Symbol('CALLS_PRISMA');

type Fn = (args: any) => Promise<any>;
export interface CallsPrisma {
  conversationMember: { count: Fn };
  block: { count: Fn };
  device: { findFirst: Fn };
  callReport: { create: Fn; count: Fn };
  callPushToken: { upsert: Fn; findMany: Fn; deleteMany: Fn };
}
