import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from './current-user-id.decorator';
import { AVATAR_MAX_BYTES, ProfileService } from './profile.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  /** GET /users/me/profile  →  { id, username, avatarUrl } */
  @Get('me/profile')
  getMine(@CurrentUserId() userId: string) {
    return this.profile.getProfile(userId);
  }

  /** GET /users/username-available?username=keona  →  { username, available, reason? } */
  @Get('username-available')
  checkUsername(@Query('username') username: string, @CurrentUserId() userId: string) {
    return this.profile.isUsernameAvailable(username, userId);
  }

  /** PATCH /users/me/username  body { username }  →  profile */
  @Patch('me/username')
  setUsername(@Body() body: { username?: unknown }, @CurrentUserId() userId: string) {
    return this.profile.setUsername(userId, body?.username);
  }

  /** POST /users/me/avatar  multipart field "avatar"  →  profile */
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
    }),
  )
  uploadAvatar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUserId() userId: string,
  ) {
    return this.profile.setAvatar(userId, file);
  }

  /** DELETE /users/me/avatar  →  profile */
  @Delete('me/avatar')
  removeAvatar(@CurrentUserId() userId: string) {
    return this.profile.removeAvatar(userId);
  }

  /**
   * GET /users/:id/avatar  →  image bytes.
   * Requires a valid JWT, so avatars are only visible to signed-in Linqa users.
   * If your user ids are not UUIDs, remove the ParseUUIDPipe.
   */
  @Get(':id/avatar')
  async getAvatar(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    const { filePath, mime } = await this.profile.getAvatarFile(id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  }
}
