import type { WebSocket } from "ws";
import { createAuthorizedSender } from "./authorized-sender.js";

interface Connection {
  socket: WebSocket;
  userId: string;
  deviceId: string;
  authorize?: () => Promise<boolean>;
}

export class RealtimeHub {
  private readonly senders = new WeakMap<Connection, (message: string) => void>();
  private readonly byDevice = new Map<string, Set<Connection>>();

  add(connection: Connection): () => void {
    const set = this.byDevice.get(connection.deviceId) ?? new Set<Connection>();
    set.add(connection);
    this.byDevice.set(connection.deviceId, set);

    return () => {
      set.delete(connection);
      if (set.size === 0 && this.byDevice.get(connection.deviceId) === set) this.byDevice.delete(connection.deviceId);
    };
  }

  notifyEnvelopeAvailable(deviceId: string, serverSequence: number): void {
    this.sendToDevice(deviceId, { type: "envelope.available", serverSequence });
  }

  sendToDevice(deviceId: string, payload: unknown): void {
    const set = this.byDevice.get(deviceId);
    if (!set) return;

    const message = JSON.stringify(payload);
    for (const connection of set) {
      if (connection.socket.readyState === connection.socket.OPEN) {
        this.send(connection, message);
      }
    }
  }

  sendToUser(userId: string, payload: unknown): void {
    const delivered = new Set<WebSocket>();
    const message = JSON.stringify(payload);
    for (const connections of this.byDevice.values()) {
      for (const connection of connections) {
        if (
          connection.userId === userId &&
          connection.socket.readyState === connection.socket.OPEN &&
          !delivered.has(connection.socket)
        ) {
          this.send(connection, message);
          delivered.add(connection.socket);
        }
      }
    }
  }

  disconnectDevice(deviceId: string, code = 4003, reason = "device revoked"): void {
    const set = this.byDevice.get(deviceId);
    if (!set) return;
    for (const connection of set) {
      connection.socket.close(code, reason);
    }
    this.byDevice.delete(deviceId);
  }

  private send(connection: Connection, message: string): void {
    let send = this.senders.get(connection);
    if (!send) { send = createAuthorizedSender(connection.socket, connection.authorize); this.senders.set(connection, send); }
    send(message);
  }
}
