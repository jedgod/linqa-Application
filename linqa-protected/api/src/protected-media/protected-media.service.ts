import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { hashEvent, verifyChain, type ChainCheck } from './audit-chain';
import { MediaEventsService, type SenderAlertType } from './media-events.service';
import { parsePolicy, PolicyError, type PolicyInput } from './policy';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Where ciphertext files live. Point at a private, non-web-served volume. */
export const PROTECTED_MEDIA_DIR = path.resolve(process.env.PROTECTED_MEDIA_DIR ?? 'uploads/protected');
export const MAX_CIPHERTEXT_BYTES = 15 * 1024 * 1024;
/** A granted view must download its ciphertext within this time. */
const TOKEN_TTL_MS = 30_000;
/** Media nobody opens is closed after this long, whatever the mode. */
const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

type Status = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'REVOKED' | 'CAPTURE_REVOKED';
type ClosingStatus = Exclude<Status, 'ACTIVE'>;
type AuditType =
  | 'CREATED'
  | 'VIEW_GRANTED'
  | 'BLOB_DELIVERED'
  | 'VIEW_ENDED'
  | 'ACCESS_DENIED'
  | 'SCREENSHOT_DETECTED'
  | 'SCREEN_RECORDING_DETECTED'
  | 'EXHAUSTED'
  | 'EXPIRED'
  | 'REVOKED_BY_SENDER'
  | 'CAPTURE_REVOKED'
  | 'BLOB_DELETED';

export type MediaRow = {
  id: string;
  senderId: string;
  recipientId: string;
  conversationId: string | null;
  mode: 'MULTI_VIEW' | 'TIMED' | 'EPHEMERAL';
  maxViews: number | null;
  windowSeconds: number | null;
  expiryStart: 'ON_SEND' | 'ON_FIRST_VIEW' | null;
  viewSeconds: number;
  notifyOnView: boolean;
  revokeOnCapture: boolean;
  blobKey: string | null;
  sizeBytes: number;
  viewCount: number;
  status: Status;
  createdAt: Date;
  firstViewedAt: Date | null;
  expiresAt: Date | null;
  closedAt: Date | null;
  closeReason: string | null;
};

type AuditRow = {
  mediaId: string;
  seq: number;
  type: string;
  actorId: string | null;
  viewNumber: number | null;
  at: Date;
  detail: unknown;
  prevHash: string | null;
  hash: string;
};

/** Device details the client may attach to view and capture events. */
export type ClientInfo = { platform?: string; osVersion?: string; appVersion?: string };

export type EndReason = 'timer' | 'closed' | 'capture' | 'background' | 'expired';
const END_REASONS: EndReason[] = ['timer', 'closed', 'capture', 'background', 'expired'];

export type CaptureKind = 'screenshot' | 'recording';

// Same delegates on PrismaService and on the transaction client.
type Db = Pick<PrismaService, 'protectedMedia' | 'mediaView' | 'mediaAuditEvent'>;

class RetryableConflict extends Error {}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      const retryable = e instanceof RetryableConflict || code === 'P2002' || code === 'P2034';
      if (!retryable || i >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 15 * (i + 1)));
    }
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function cleanClientInfo(info: unknown): ClientInfo {
  const src = (info ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof src[k] === 'string' ? (src[k] as string).slice(0, 40) : undefined);
  return { platform: pick('platform'), osVersion: pick('osVersion'), appVersion: pick('appVersion') };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ProtectedMediaService {
  private readonly log = new Logger(ProtectedMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: MediaEventsService,
  ) {}

  // ----- audit -------------------------------------------------------------

  private async audit(
    db: Db,
    mediaId: string,
    type: AuditType,
    actorId: string | null,
    viewNumber: number | null = null,
    detail: Record<string, unknown> | null = null,
  ) {
    const last = await db.mediaAuditEvent.findFirst({
      where: { mediaId },
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true },
    });
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? null;
    const at = new Date();
    // Round-trip through JSON so the hashed form equals what the database returns.
    const cleanDetail = detail ? (JSON.parse(JSON.stringify(detail)) as Record<string, unknown>) : null;
    const hash = hashEvent({ mediaId, seq, type, actorId, viewNumber, at, detail: cleanDetail, prevHash });
    await db.mediaAuditEvent.create({
      data: {
        mediaId,
        seq,
        type,
        actorId,
        viewNumber,
        at,
        ...(cleanDetail ? { detail: cleanDetail as object } : {}),
        prevHash,
        hash,
      },
    });
  }

  // ----- create ------------------------------------------------------------

  async create(
    senderId: string,
    body: { recipientId?: unknown; conversationId?: unknown; policy?: unknown },
    file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('No encrypted file received.');
    if (file.size > MAX_CIPHERTEXT_BYTES) throw new BadRequestException('File is too large.');

    const recipientId = typeof body.recipientId === 'string' ? body.recipientId : '';
    if (!recipientId) throw new BadRequestException('recipientId is required.');
    if (recipientId === senderId) throw new BadRequestException('You cannot send protected media to yourself.');
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;

    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!recipient) throw new NotFoundException('Recipient not found.');
    // TODO: also confirm sender and recipient share `conversationId` (or are contacts),
    // using your existing conversation membership check.

    let policyInput: PolicyInput;
    try {
      policyInput = typeof body.policy === 'string' ? JSON.parse(body.policy) : ((body.policy ?? {}) as PolicyInput);
    } catch {
      throw new BadRequestException('policy must be JSON.');
    }
    let policy;
    try {
      policy = parsePolicy(policyInput);
    } catch (e) {
      if (e instanceof PolicyError) throw new BadRequestException(e.message);
      throw e;
    }

    const id = randomUUID();
    const blobKey = `${id}.bin`;
    await fs.mkdir(PROTECTED_MEDIA_DIR, { recursive: true });
    await fs.writeFile(path.join(PROTECTED_MEDIA_DIR, blobKey), file.buffer, { mode: 0o600 });

    const now = new Date();
    const expiresAt =
      policy.mode === 'TIMED' && policy.expiryStart === 'ON_SEND'
        ? new Date(now.getTime() + policy.windowSeconds! * 1000)
        : null;

    try {
      const media = await this.prisma.$transaction(async (tx) => {
        const m = (await tx.protectedMedia.create({
          data: {
            id,
            senderId,
            recipientId,
            conversationId,
            mode: policy.mode,
            maxViews: policy.maxViews,
            windowSeconds: policy.windowSeconds,
            expiryStart: policy.expiryStart,
            viewSeconds: policy.viewSeconds,
            notifyOnView: policy.notifyOnView,
            revokeOnCapture: policy.revokeOnCapture,
            blobKey,
            sizeBytes: file.size,
            createdAt: now,
            expiresAt,
          },
        })) as MediaRow;
        await this.audit(tx, id, 'CREATED', senderId, null, {
          mode: policy.mode,
          maxViews: policy.maxViews,
          windowSeconds: policy.windowSeconds,
          expiryStart: policy.expiryStart,
          viewSeconds: policy.viewSeconds,
          revokeOnCapture: policy.revokeOnCapture,
          sizeBytes: file.size,
        });
        return m;
      });
      return this.toPublic(media, senderId);
    } catch (e) {
      await this.deleteFile(blobKey);
      throw e;
    }
  }

  // ----- viewing -----------------------------------------------------------

  private denial(m: MediaRow, now: Date): string | null {
    if (m.status !== 'ACTIVE') return m.status;
    if (!m.blobKey) return 'DELETED';
    if (m.expiresAt && now >= m.expiresAt) return 'EXPIRED';
    if (now.getTime() - m.createdAt.getTime() > MAX_LIFETIME_MS) return 'EXPIRED';
    if (m.maxViews !== null && m.viewCount >= m.maxViews) return 'EXHAUSTED';
    return null;
  }

  /**
   * Step 1 of a view. Counts the view, writes the audit event, and returns a
   * single-use token for downloading the ciphertext.
   */
  async requestView(mediaId: string, viewerId: string, clientInfo: unknown) {
    const info = cleanClientInfo(clientInfo);

    const result = await withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const m = (await tx.protectedMedia.findUnique({ where: { id: mediaId } })) as MediaRow | null;
        // Hide existence from anyone but the recipient. The sender cannot spend views either.
        if (!m || m.recipientId !== viewerId) throw new NotFoundException();

        const now = new Date();
        const reason = this.denial(m, now);
        if (reason) {
          await this.audit(tx, mediaId, 'ACCESS_DENIED', viewerId, null, { reason, ...info });
          return { denied: reason, media: m };
        }

        let expiresAt = m.expiresAt;
        const firstViewedAt = m.firstViewedAt ?? now;
        if (m.mode === 'TIMED' && m.expiryStart === 'ON_FIRST_VIEW' && !m.firstViewedAt) {
          expiresAt = new Date(now.getTime() + m.windowSeconds! * 1000);
        }

        // Optimistic lock on viewCount, so two devices cannot both take the last view.
        const claimed = await tx.protectedMedia.updateMany({
          where: { id: mediaId, status: 'ACTIVE', viewCount: m.viewCount },
          data: { viewCount: m.viewCount + 1, firstViewedAt, expiresAt },
        });
        if (claimed.count !== 1) throw new RetryableConflict();

        const viewNumber = m.viewCount + 1;
        const token = randomBytes(32).toString('base64url');
        const view = await tx.mediaView.create({
          data: {
            mediaId,
            viewerId,
            viewNumber,
            tokenHash: sha256(token),
            tokenExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
            startedAt: now,
          },
        });
        await this.audit(tx, mediaId, 'VIEW_GRANTED', viewerId, viewNumber, { viewId: view.id, ...info });

        const secondsLeftInWindow = expiresAt
          ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
          : null;
        const displaySeconds =
          secondsLeftInWindow === null ? m.viewSeconds : Math.min(m.viewSeconds, secondsLeftInWindow);

        return {
          denied: null,
          media: { ...m, viewCount: viewNumber, firstViewedAt, expiresAt },
          grant: {
            viewId: view.id,
            token,
            viewNumber,
            remainingViews: m.maxViews === null ? null : m.maxViews - viewNumber,
            displaySeconds,
            expiresAt: expiresAt?.toISOString() ?? null,
            tokenExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
            revokeOnCapture: m.revokeOnCapture,
          },
        };
      }),
    );

    if (result.denied) {
      if (result.denied === 'EXPIRED' && result.media.status === 'ACTIVE') {
        await this.close(mediaId, 'EXPIRED', null, 'time window ended');
      }
      throw new GoneException({ message: 'This photo is no longer available.', status: result.denied });
    }

    const m = result.media;
    if (m.notifyOnView) {
      this.alertSender(m, 'VIEWED', result.grant!.viewNumber, result.grant!.remainingViews);
    }
    return result.grant!;
  }

  /**
   * Step 2 of a view. Returns the ciphertext bytes exactly once per granted view.
   * When this was the final allowed view, the media is closed and the file deleted
   * right after the bytes are read.
   */
  async fetchCiphertext(mediaId: string, viewId: string, viewerId: string, token: string): Promise<Buffer> {
    if (!token || typeof token !== 'string') throw new NotFoundException();

    const { blobKey, isFinal, viewNumber } = await this.prisma.$transaction(async (tx) => {
      const view = await tx.mediaView.findUnique({ where: { id: viewId } });
      if (!view || view.mediaId !== mediaId || view.viewerId !== viewerId) throw new NotFoundException();
      if (!safeEqualHex(view.tokenHash, sha256(token))) throw new NotFoundException();

      const now = new Date();
      if (view.blobFetchedAt) throw new GoneException('This view was already used.');
      if (view.tokenExpiresAt <= now) throw new GoneException('This view request timed out.');

      const m = (await tx.protectedMedia.findUnique({ where: { id: mediaId } })) as MediaRow | null;
      if (!m || m.status !== 'ACTIVE' || !m.blobKey) throw new GoneException('This photo is no longer available.');
      if (m.expiresAt && now >= m.expiresAt) throw new GoneException('This photo has expired.');

      const claimed = await tx.mediaView.updateMany({
        where: { id: viewId, blobFetchedAt: null },
        data: { blobFetchedAt: now },
      });
      if (claimed.count !== 1) throw new GoneException('This view was already used.');

      await this.audit(tx, mediaId, 'BLOB_DELIVERED', viewerId, view.viewNumber, { viewId });
      return {
        blobKey: m.blobKey,
        isFinal: m.maxViews !== null && view.viewNumber >= m.maxViews,
        viewNumber: view.viewNumber,
      };
    });

    const bytes = await fs.readFile(this.safePath(blobKey));
    if (isFinal) {
      await this.close(mediaId, 'EXHAUSTED', null, `view limit reached on view ${viewNumber}`);
    }
    return bytes;
  }

  /** Step 3 of a view. The client reports when the viewer closed and why. */
  async endView(mediaId: string, viewId: string, viewerId: string, reason: unknown) {
    const why: EndReason = END_REASONS.includes(reason as EndReason) ? (reason as EndReason) : 'closed';
    await this.prisma.$transaction(async (tx) => {
      const view = await tx.mediaView.findUnique({ where: { id: viewId } });
      if (!view || view.mediaId !== mediaId || view.viewerId !== viewerId) throw new NotFoundException();
      const now = new Date();
      const done = await tx.mediaView.updateMany({
        where: { id: viewId, endedAt: null },
        data: { endedAt: now, endReason: why },
      });
      if (done.count === 1) {
        await this.audit(tx, mediaId, 'VIEW_ENDED', viewerId, view.viewNumber, {
          viewId,
          reason: why,
          durationMs: now.getTime() - view.startedAt.getTime(),
        });
      }
    });
    return { ok: true };
  }

  // ----- capture -----------------------------------------------------------

  /**
   * The recipient's app detected a screenshot or screen recording while the
   * photo was on screen. Always logged and reported to the sender; in EPHEMERAL
   * mode it also revokes access and deletes the ciphertext immediately.
   */
  async reportCapture(mediaId: string, viewerId: string, kind: unknown, viewId: unknown, clientInfo: unknown) {
    if (kind !== 'screenshot' && kind !== 'recording') throw new BadRequestException('kind must be screenshot or recording');
    const info = cleanClientInfo(clientInfo);

    const m = await withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const media = (await tx.protectedMedia.findUnique({ where: { id: mediaId } })) as MediaRow | null;
        if (!media || media.recipientId !== viewerId) throw new NotFoundException();
        await this.audit(
          tx,
          mediaId,
          kind === 'screenshot' ? 'SCREENSHOT_DETECTED' : 'SCREEN_RECORDING_DETECTED',
          viewerId,
          null,
          { viewId: typeof viewId === 'string' ? viewId : null, ...info },
        );
        return media;
      }),
    );

    this.alertSender(m, kind === 'screenshot' ? 'SCREENSHOT' : 'SCREEN_RECORDING');

    if (m.revokeOnCapture && m.status === 'ACTIVE') {
      await this.close(mediaId, 'CAPTURE_REVOKED', viewerId, `${kind} detected`);
      return { revoked: true };
    }
    return { revoked: false };
  }

  // ----- sender actions ----------------------------------------------------

  async revoke(mediaId: string, senderId: string) {
    const m = (await this.prisma.protectedMedia.findUnique({ where: { id: mediaId } })) as MediaRow | null;
    if (!m) throw new NotFoundException();
    if (m.senderId !== senderId) throw new ForbiddenException();
    await this.close(mediaId, 'REVOKED', senderId, 'revoked by sender');
    return this.getStatus(mediaId, senderId);
  }

  // ----- reading -----------------------------------------------------------

  private async loadForParticipant(mediaId: string, userId: string): Promise<MediaRow> {
    const m = (await this.prisma.protectedMedia.findUnique({ where: { id: mediaId } })) as MediaRow | null;
    if (!m || (m.senderId !== userId && m.recipientId !== userId)) throw new NotFoundException();
    return m;
  }

  async getStatus(mediaId: string, userId: string) {
    const m = await this.loadForParticipant(mediaId, userId);
    // Close lazily if the sweeper has not run yet.
    if (m.status === 'ACTIVE' && this.denial(m, new Date()) === 'EXPIRED') {
      await this.close(mediaId, 'EXPIRED', null, 'time window ended');
      return this.toPublic(await this.loadForParticipant(mediaId, userId), userId);
    }
    return this.toPublic(m, userId);
  }

  async getAudit(mediaId: string, userId: string) {
    const m = await this.loadForParticipant(mediaId, userId);
    const rows: AuditRow[] = await this.prisma.mediaAuditEvent.findMany({
      where: { mediaId },
      orderBy: { seq: 'asc' },
    });
    let integrity: ChainCheck;
    try {
      integrity = verifyChain(
        rows.map((r) => ({
          mediaId: r.mediaId,
          seq: r.seq,
          type: r.type,
          actorId: r.actorId,
          viewNumber: r.viewNumber,
          at: r.at,
          detail: r.detail ?? null,
          prevHash: r.prevHash,
          hash: r.hash,
        })),
      );
    } catch (e) {
      this.log.error(`audit verify failed for ${mediaId}: ${(e as Error).message}`);
      integrity = { valid: false, brokenAtSeq: 0, reason: 'Could not verify' };
    }
    return {
      media: this.toPublic(m, userId),
      integrity,
      events: rows.map((r) => ({
        seq: r.seq,
        type: r.type,
        at: r.at.toISOString(),
        actor: r.actorId === m.senderId ? 'sender' : r.actorId === m.recipientId ? 'recipient' : 'system',
        actorId: r.actorId,
        viewNumber: r.viewNumber,
        detail: r.detail ?? null,
        hash: r.hash,
      })),
    };
  }

  // ----- closing -----------------------------------------------------------

  /** Move ACTIVE media to a final status, audit it, delete the ciphertext, alert the sender. */
  async close(mediaId: string, status: ClosingStatus, actorId: string | null, reason: string) {
    const auditType: Record<ClosingStatus, AuditType> = {
      EXHAUSTED: 'EXHAUSTED',
      EXPIRED: 'EXPIRED',
      REVOKED: 'REVOKED_BY_SENDER',
      CAPTURE_REVOKED: 'CAPTURE_REVOKED',
    };

    const closed = await withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const m = (await tx.protectedMedia.findUnique({ where: { id: mediaId } })) as MediaRow | null;
        if (!m || m.status !== 'ACTIVE') return null;
        const done = await tx.protectedMedia.updateMany({
          where: { id: mediaId, status: 'ACTIVE' },
          data: { status, closedAt: new Date(), closeReason: reason },
        });
        if (done.count !== 1) throw new RetryableConflict();
        await this.audit(tx, mediaId, auditType[status], actorId, null, { reason });
        return m;
      }),
    );
    if (!closed) return;

    if (closed.blobKey) {
      await this.deleteFile(closed.blobKey);
      await withRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await tx.protectedMedia.updateMany({ where: { id: mediaId }, data: { blobKey: null } });
          await this.audit(tx, mediaId, 'BLOB_DELETED', null, null, null);
        }),
      );
    }

    if (status !== 'REVOKED') {
      this.alertSender(closed, status === 'EXHAUSTED' ? 'EXHAUSTED' : status === 'EXPIRED' ? 'EXPIRED' : 'CAPTURE_REVOKED');
    }
  }

  /** Runs on a timer (see ProtectedMediaSweeper). */
  async sweep(now = new Date()) {
    let closedCount = 0;

    const expired = await this.prisma.protectedMedia.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ expiresAt: { lte: now } }, { createdAt: { lte: new Date(now.getTime() - MAX_LIFETIME_MS) } }],
      },
      select: { id: true },
      take: 500,
    });
    for (const { id } of expired) {
      await this.close(id, 'EXPIRED', null, 'time window ended');
      closedCount++;
    }

    // Final view granted but never downloaded: close once its token has lapsed.
    const stale: { mediaId: string }[] = await this.prisma.mediaView.findMany({
      where: { blobFetchedAt: null, tokenExpiresAt: { lte: now }, media: { status: 'ACTIVE' } },
      select: { mediaId: true },
      take: 500,
    });
    for (const mediaId of new Set(stale.map((v) => v.mediaId))) {
      const m = (await this.prisma.protectedMedia.findUnique({ where: { id: mediaId } })) as MediaRow | null;
      if (m && m.status === 'ACTIVE' && m.maxViews !== null && m.viewCount >= m.maxViews) {
        await this.close(mediaId, 'EXHAUSTED', null, 'final view was not opened in time');
        closedCount++;
      }
    }
    return closedCount;
  }

  // ----- helpers -----------------------------------------------------------

  private alertSender(
    m: MediaRow,
    type: SenderAlertType,
    viewNumber: number | null = null,
    remainingViews: number | null = null,
  ) {
    this.events.emit(m.senderId, {
      type,
      mediaId: m.id,
      conversationId: m.conversationId,
      viewNumber,
      remainingViews,
      at: new Date().toISOString(),
    });
  }

  toPublic(m: MediaRow, userId: string) {
    return {
      id: m.id,
      role: m.senderId === userId ? ('sender' as const) : ('recipient' as const),
      mode: m.mode,
      status: m.status,
      maxViews: m.maxViews,
      viewCount: m.viewCount,
      remainingViews: m.maxViews === null ? null : Math.max(0, m.maxViews - m.viewCount),
      windowSeconds: m.windowSeconds,
      expiryStart: m.expiryStart,
      viewSeconds: m.viewSeconds,
      notifyOnView: m.notifyOnView,
      revokeOnCapture: m.revokeOnCapture,
      createdAt: m.createdAt.toISOString(),
      firstViewedAt: m.firstViewedAt?.toISOString() ?? null,
      expiresAt: m.expiresAt?.toISOString() ?? null,
      closedAt: m.closedAt?.toISOString() ?? null,
    };
  }

  private safePath(key: string): string {
    const resolved = path.resolve(PROTECTED_MEDIA_DIR, path.basename(key));
    if (!resolved.startsWith(PROTECTED_MEDIA_DIR + path.sep)) throw new NotFoundException();
    return resolved;
  }

  private async deleteFile(key: string) {
    try {
      await fs.unlink(this.safePath(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.error(`could not delete ${key}: ${(e as Error).message}`);
      }
    }
  }
}
