import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../profile/current-user-id.decorator';
import { MediaEventsService } from './media-events.service';
import { MAX_CIPHERTEXT_BYTES, ProtectedMediaService } from './protected-media.service';

const uuid = new ParseUUIDPipe();

@Controller('protected-media')
@UseGuards(JwtAuthGuard)
export class ProtectedMediaController {
  constructor(
    private readonly media: ProtectedMediaService,
    private readonly events: MediaEventsService,
  ) {}

  /**
   * POST /protected-media   (multipart)
   *   file      "blob": the ENCRYPTED image bytes
   *   field     "recipientId", optional "conversationId"
   *   field     "policy": JSON, e.g. {"mode":"MULTI_VIEW","maxViews":2}
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('blob', { storage: memoryStorage(), limits: { fileSize: MAX_CIPHERTEXT_BYTES, files: 1 } }),
  )
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { recipientId?: string; conversationId?: string; policy?: string },
    @CurrentUserId() userId: string,
  ) {
    return this.media.create(userId, body, file);
  }

  /** GET /protected-media/events: Server-Sent Events with alerts for media you sent. */
  @Sse('events')
  stream(@CurrentUserId() userId: string) {
    return this.events.streamFor(userId);
  }

  /** GET /protected-media/:id: current status (sender or recipient). */
  @Get(':id')
  status(@Param('id', uuid) id: string, @CurrentUserId() userId: string) {
    return this.media.getStatus(id, userId);
  }

  /** POST /protected-media/:id/views: recipient asks to open it. Counts the view. */
  @Post(':id/views')
  @HttpCode(200)
  requestView(
    @Param('id', uuid) id: string,
    @Body() body: { client?: unknown },
    @CurrentUserId() userId: string,
  ) {
    return this.media.requestView(id, userId, body?.client);
  }

  /** GET /protected-media/:id/views/:viewId/blob?token=...: ciphertext, once. */
  @Get(':id/views/:viewId/blob')
  @Header('Cache-Control', 'no-store')
  async blob(
    @Param('id', uuid) id: string,
    @Param('viewId', uuid) viewId: string,
    @Query('token') token: string,
    @CurrentUserId() userId: string,
    @Res() res: Response,
  ) {
    const bytes = await this.media.fetchCiphertext(id, viewId, userId, token);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(bytes);
  }

  /** POST /protected-media/:id/views/:viewId/end  body { reason } */
  @Post(':id/views/:viewId/end')
  @HttpCode(200)
  endView(
    @Param('id', uuid) id: string,
    @Param('viewId', uuid) viewId: string,
    @Body() body: { reason?: unknown },
    @CurrentUserId() userId: string,
  ) {
    return this.media.endView(id, viewId, userId, body?.reason);
  }

  /** POST /protected-media/:id/capture  body { kind: "screenshot"|"recording", viewId?, client? } */
  @Post(':id/capture')
  @HttpCode(200)
  capture(
    @Param('id', uuid) id: string,
    @Body() body: { kind?: unknown; viewId?: unknown; client?: unknown },
    @CurrentUserId() userId: string,
  ) {
    return this.media.reportCapture(id, userId, body?.kind, body?.viewId, body?.client);
  }

  /** POST /protected-media/:id/revoke: sender pulls it back. */
  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@Param('id', uuid) id: string, @CurrentUserId() userId: string) {
    return this.media.revoke(id, userId);
  }

  /** GET /protected-media/:id/audit: full audit trail with integrity check. */
  @Get(':id/audit')
  audit(@Param('id', uuid) id: string, @CurrentUserId() userId: string) {
    return this.media.getAudit(id, userId);
  }
}
