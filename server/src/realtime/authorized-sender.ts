import type { WebSocket } from "ws";

/** Shared ordered delivery policy for chat and call sockets, with bounded queued authorization work. */
export function createAuthorizedSender(socket: WebSocket, authorize?: () => Promise<boolean>) {
  let pending = 0;
  let tail = Promise.resolve();
  return (message: string): void => {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > 1_048_576 || pending >= 128) { socket.close(4008, "slow consumer"); return; }
    if (!authorize) { socket.send(message); return; }
    pending += 1;
    tail = tail.then(async () => {
      if (await authorize() && socket.readyState === socket.OPEN) socket.send(message);
    }).catch(() => { socket.close(4003, "authorization unavailable"); }).finally(() => { pending -= 1; });
  };
}
