// Closes expired media and deletes their ciphertext every few seconds.
// Uses a plain interval so no extra scheduling package is needed.
// If you run more than one API instance, this is still safe: closing is
// idempotent and guarded by the ACTIVE status check.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ProtectedMediaService } from './protected-media.service';

const INTERVAL_MS = 5_000;

@Injectable()
export class ProtectedMediaSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ProtectedMediaSweeper.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly media: ProtectedMediaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const closed = await this.media.sweep();
      if (closed) this.log.log(`closed ${closed} protected media item(s)`);
    } catch (e) {
      this.log.error(`sweep failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
