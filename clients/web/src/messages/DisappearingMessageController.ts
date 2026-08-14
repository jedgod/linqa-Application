export class DisappearingMessageController {
  private timers = new Map<string, number>();

  schedule(input: {
    messageId: string;
    expiresAt: string;
    onExpire: (messageId: string) => Promise<void> | void;
  }) {
    this.cancel(input.messageId);

    const delay = new Date(input.expiresAt).getTime() - Date.now();
    if (delay <= 0) {
      void input.onExpire(input.messageId);
      return;
    }

    const timer = window.setTimeout(() => {
      this.timers.delete(input.messageId);
      void input.onExpire(input.messageId);
    }, Math.min(delay, 2_147_483_647));

    this.timers.set(input.messageId, timer);
  }

  cancel(messageId: string) {
    const timer = this.timers.get(messageId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(messageId);
    }
  }

  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
