import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaEventsService } from './media-events.service';
import { ProtectedMediaController } from './protected-media.controller';
import { ProtectedMediaService } from './protected-media.service';
import { ProtectedMediaSweeper } from './protected-media.sweeper';

// Add ProtectedMediaModule to AppModule's `imports`.
// Requires env AUDIT_SECRET (32+ random characters) and optionally PROTECTED_MEDIA_DIR.
// If you have a PrismaModule that exports PrismaService, import it instead.
@Module({
  controllers: [ProtectedMediaController],
  providers: [PrismaService, MediaEventsService, ProtectedMediaService, ProtectedMediaSweeper],
})
export class ProtectedMediaModule {}
