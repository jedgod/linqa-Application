export class TeleprompterController {
  private timer: number | null = null;
  private position = 0;

  constructor(
    private readonly onPosition: (position: number) => void
  ) {}

  start(speedPixelsPerSecond: number): void {
    this.stop();
    const started = performance.now();
    const initial = this.position;

    const tick = (time: number) => {
      this.position = initial + ((time - started) / 1000) * speedPixelsPerSecond;
      this.onPosition(this.position);
      this.timer = requestAnimationFrame(tick);
    };

    this.timer = requestAnimationFrame(tick);
  }

  pause(): void {
    this.stop();
  }

  reset(): void {
    this.stop();
    this.position = 0;
    this.onPosition(0);
  }

  private stop(): void {
    if (this.timer !== null) {
      cancelAnimationFrame(this.timer);
      this.timer = null;
    }
  }
}
