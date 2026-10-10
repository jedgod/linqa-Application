import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AiImageClient, MediaStore, PrismaService } from "./media.store";
import type { AiGenerateDto, MeetingRespondDto, RsvpDto, SendAttachmentDto, VoteDto } from "./dto";

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly media: MediaStore,
    private readonly images: AiImageClient,
  ) {}

  async send(threadId: string, senderId: string, dto: SendAttachmentDto) {
    this.assertSeal(dto);
    await this.db.thread.upsert({ where: { id: threadId }, update: {}, create: { id: threadId } });

    const closesAt = dto.poll ? this.closeAt(dto.poll.closeVoting) : null;
    const created = await this.db.attachment.create({
      data: {
        threadId,
        senderId,
        kind: dto.kind,
        sealedPayload: dto.sealedPayload,
        cleartextException: dto.cleartextException,
        caption: dto.caption,
        media: dto.media
          ? { create: dto.media.map((item) => ({ ...item, waveform: item.waveform ?? undefined })) }
          : undefined,
        poll: dto.poll
          ? { create: { ...dto.poll, options: dto.poll.options, closesAt } }
          : undefined,
        event: dto.event
          ? { create: { ...dto.event, rsvps: { create: { userId: senderId, value: "going" } } } }
          : undefined,
        meeting: dto.meeting
          ? { create: { ...dto.meeting, callId: crypto.randomUUID(), status: "pending" } }
          : undefined,
        location: dto.location ? { create: dto.location } : undefined,
        contact: dto.contact ? { create: dto.contact } : undefined,
        document: dto.document ? { create: dto.document } : undefined,
        screenShare: dto.screenShare
          ? {
              create: {
                threadId,
                presenterId: senderId,
                presenterName: dto.screenShare.presenterName,
                sharedTitle: dto.screenShare.sharedTitle,
                live: true,
              },
            }
          : undefined,
      },
      include: this.include(),
    });
    return this.toCard(created, senderId);
  }

  async list(threadId: string, viewerId: string) {
    const rows = await this.db.attachment.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
      include: this.include(),
    });
    return rows.map((row) => this.toCard(row, viewerId));
  }

  async vote(attachmentId: string, voterId: string, dto: VoteDto) {
    const poll = await this.db.poll.findUnique({ where: { attachmentId }, include: { votes: true } });
    if (!poll) throw new NotFoundException("Poll not found");
    if (poll.closesAt && poll.closesAt.getTime() < Date.now()) throw new BadRequestException("Voting is closed");
    const picks = dto.picks.filter((index) => index >= 0 && index < (poll.options as string[]).length);
    if (!poll.allowMultiple && picks.length > 1) throw new BadRequestException("Single answer only");
    await this.db.pollVote.upsert({
      where: { pollId_voterId: { pollId: poll.id, voterId } },
      update: { picks },
      create: { pollId: poll.id, voterId, picks },
    });
    return this.one(attachmentId, voterId);
  }

  async rsvp(attachmentId: string, userId: string, dto: RsvpDto) {
    const event = await this.db.event.findUnique({ where: { attachmentId } });
    if (!event) throw new NotFoundException("Event not found");
    await this.db.rsvp.upsert({
      where: { eventId_userId: { eventId: event.id, userId } },
      update: { value: dto.value },
      create: { eventId: event.id, userId, value: dto.value },
    });
    return this.one(attachmentId, userId);
  }

  async respondMeeting(attachmentId: string, userId: string, dto: MeetingRespondDto) {
    const meeting = await this.db.meeting.findUnique({ where: { attachmentId } });
    if (!meeting) throw new NotFoundException("Meeting not found");
    await this.db.meetingResponse.upsert({
      where: { meetingId_userId: { meetingId: meeting.id, userId } },
      update: { value: dto.value, suggested: dto.suggestedIso ? new Date(dto.suggestedIso) : null },
      create: {
        meetingId: meeting.id,
        userId,
        value: dto.value,
        suggested: dto.suggestedIso ? new Date(dto.suggestedIso) : null,
      },
    });
    if (dto.value === "accepted") {
      await this.db.meeting.update({ where: { id: meeting.id }, data: { status: "accepted" } });
    }
    return this.one(attachmentId, userId);
  }

  async uploadMedia(threadId: string, senderId: string, file: { mime: string; bytes: Buffer }) {
    if (!file.bytes?.length) throw new BadRequestException("Empty media");
    const stored = await this.media.put(threadId, senderId, file.bytes, file.mime);
    return stored;
  }

  async downloadMedia(storageKey: string, requesterId: string) {
    const row = await this.db.mediaObject.findFirst({ where: { storageKey }, include: { attachment: true } });
    if (!row) throw new NotFoundException("Media not found");
    if (!(await this.isMember(row.attachment.threadId, requesterId))) throw new ForbiddenException();
    return this.media.get(storageKey);
  }

  async generateImage(dto: AiGenerateDto) {
    if (!dto.prompt.trim()) throw new BadRequestException("Prompt required");
    const generated = await this.images.generate(dto.prompt.trim(), dto.style);
    return {
      promptLeftDevice: true,
      style: dto.style,
      previews: generated.previews.map((item) => ({ mime: item.mime, storageKey: item.storageKey })),
    };
  }

  async endShare(sessionId: string, presenterId: string) {
    const share = await this.db.screenShare.findUnique({ where: { id: sessionId } });
    if (!share) throw new NotFoundException("Share not found");
    if (share.presenterId !== presenterId) throw new ForbiddenException();
    return this.db.screenShare.update({ where: { id: sessionId }, data: { live: false, endedAt: new Date() } });
  }

  private async one(attachmentId: string, viewerId: string) {
    const row = await this.db.attachment.findUnique({ where: { id: attachmentId }, include: this.include() });
    if (!row) throw new NotFoundException();
    return this.toCard(row, viewerId);
  }

  private assertSeal(dto: SendAttachmentDto) {
    if (!dto.sealedPayload) throw new BadRequestException("sealedPayload required");
    if (dto.cleartextException && dto.kind !== "ai_image") {
      throw new BadRequestException("cleartextException is only valid for ai_image");
    }
    if (dto.kind === "ai_image" && dto.cleartextException !== "ai_prompt") {
      throw new BadRequestException("ai_image must declare cleartextException=ai_prompt");
    }
  }

  private closeAt(closeVoting: "1h" | "1d" | "never") {
    if (closeVoting === "never") return null;
    const ms = closeVoting === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ms);
  }

  private async isMember(threadId: string, userId: string) {
    const thread = await this.db.thread.findUnique({ where: { id: threadId } });
    return Boolean(thread) && Boolean(userId);
  }

  private include() {
    return {
      media: true,
      poll: { include: { votes: true } },
      event: { include: { rsvps: true } },
      meeting: { include: { responses: true } },
      location: true,
      contact: true,
      document: true,
      screenShare: true,
    } as const;
  }

  private toCard(row: any, viewerId: string) {
    const base = {
      id: row.id,
      threadId: row.threadId,
      senderId: row.senderId,
      kind: row.kind,
      createdAt: row.createdAt,
      sealedPayload: row.sealedPayload,
      cleartextException: row.cleartextException,
      caption: row.caption,
      media: row.media,
    };
    if (row.poll) {
      const counts = (row.poll.options as string[]).map(() => 0);
      for (const vote of row.poll.votes) {
        for (const pick of vote.picks as number[]) if (counts[pick] !== undefined) counts[pick] += 1;
      }
      return {
        ...base,
        poll: {
          question: row.poll.question,
          options: row.poll.options,
          allowMultiple: row.poll.allowMultiple,
          hideVoters: row.poll.hideVoters,
          closeVoting: row.poll.closeVoting,
          closesAt: row.poll.closesAt,
          counts,
          myPicks: (row.poll.votes.find((vote: any) => vote.voterId === viewerId)?.picks as number[]) ?? [],
          voters: row.poll.hideVoters ? undefined : row.poll.votes,
          totalVoters: row.poll.votes.filter((vote: any) => (vote.picks as number[]).length).length,
        },
      };
    }
    if (row.event) return { ...base, event: row.event, myRsvp: row.event.rsvps.find((item: any) => item.userId === viewerId)?.value };
    if (row.meeting) return { ...base, meeting: row.meeting, joinOpensMinBefore: row.meeting.joinOpensMinBefore };
    if (row.location) return { ...base, location: row.location };
    if (row.contact) return { ...base, contact: row.contact };
    if (row.document) return { ...base, document: row.document };
    if (row.screenShare) return { ...base, screenShare: row.screenShare };
    return base;
  }
}
