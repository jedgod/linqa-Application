import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { validateUsername } from './username';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

// Where avatar files live on disk. Set UPLOAD_DIR in your .env for production
// (for example a mounted volume). Defaults to ./uploads next to the API.
const AVATAR_DIR = path.resolve(process.env.UPLOAD_DIR ?? 'uploads', 'avatars');

export type ProfileDto = {
  id: string;
  username: string | null;
  /** Relative API path for the avatar, or null. Clients prefix their API base URL. */
  avatarUrl: string | null;
};

type ImageKind = { ext: 'jpg' | 'png' | 'webp'; mime: string };

/** Identify the image by its first bytes, not the client-supplied mimetype. */
function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(user: {
    id: string;
    username: string | null;
    avatarKey: string | null;
    avatarUpdatedAt: Date | null;
  }): ProfileDto {
    const version = user.avatarUpdatedAt?.getTime() ?? 0;
    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarKey ? `/users/${user.id}/avatar?v=${version}` : null,
    };
  }

  private async findUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, avatarKey: true, avatarUpdatedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getProfile(userId: string): Promise<ProfileDto> {
    return this.toDto(await this.findUser(userId));
  }

  async isUsernameAvailable(
    raw: unknown,
    userId: string,
  ): Promise<{ username: string; available: boolean; reason?: string }> {
    const check = validateUsername(raw);
    if (!check.ok) {
      return { username: String(raw ?? ''), available: false, reason: check.reason };
    }
    const owner = await this.prisma.user.findUnique({
      where: { username: check.username },
      select: { id: true },
    });
    const available = !owner || owner.id === userId;
    return {
      username: check.username,
      available,
      reason: available ? undefined : 'That username is taken.',
    };
  }

  async setUsername(userId: string, raw: unknown): Promise<ProfileDto> {
    const check = validateUsername(raw);
    if (!check.ok) throw new BadRequestException(check.reason);

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { username: check.username },
        select: { id: true, username: true, avatarKey: true, avatarUpdatedAt: true },
      });
      return this.toDto(user);
    } catch (err) {
      // Unique constraint: someone else claimed it between the check and the save.
      if ((err as { code?: unknown } | null)?.code === 'P2002') {
        throw new ConflictException('That username is taken.');
      }
      throw err;
    }
  }

  async setAvatar(userId: string, file: { buffer: Buffer; size: number } | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('No image received.');
    if (file.size > AVATAR_MAX_BYTES) throw new BadRequestException('Image must be under 5 MB.');

    const kind = sniffImage(file.buffer);
    if (!kind) throw new BadRequestException('Use a JPEG, PNG or WebP image.');

    const previous = await this.findUser(userId);

    await fs.mkdir(AVATAR_DIR, { recursive: true });
    const key = `${userId}-${randomUUID()}.${kind.ext}`;
    await fs.writeFile(path.join(AVATAR_DIR, key), file.buffer, { mode: 0o600 });

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: key, avatarUpdatedAt: new Date() },
      select: { id: true, username: true, avatarKey: true, avatarUpdatedAt: true },
    });

    if (previous.avatarKey) await this.deleteFile(previous.avatarKey);
    return this.toDto(user);
  }

  async removeAvatar(userId: string): Promise<ProfileDto> {
    const previous = await this.findUser(userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: null, avatarUpdatedAt: new Date() },
      select: { id: true, username: true, avatarKey: true, avatarUpdatedAt: true },
    });
    if (previous.avatarKey) await this.deleteFile(previous.avatarKey);
    return this.toDto(user);
  }

  /** Absolute path and mime type of a user's avatar, for streaming. */
  async getAvatarFile(userId: string): Promise<{ filePath: string; mime: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    });
    if (!user?.avatarKey) throw new NotFoundException('No avatar');

    const filePath = this.safePath(user.avatarKey);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('No avatar');
    }
    const mime = MIME_BY_EXT[path.extname(filePath)] ?? 'application/octet-stream';
    return { filePath, mime };
  }

  private safePath(key: string): string {
    const resolved = path.resolve(AVATAR_DIR, path.basename(key));
    if (!resolved.startsWith(AVATAR_DIR + path.sep)) throw new NotFoundException('No avatar');
    return resolved;
  }

  private async deleteFile(key: string) {
    try {
      await fs.unlink(this.safePath(key));
    } catch {
      // Already gone; nothing to do.
    }
  }
}
