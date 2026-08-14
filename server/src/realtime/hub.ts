import type { WebSocket } from "ws";

interface Connection {
  socket: WebSocket;
  userId: string;
  deviceId: string;
}

export class RealtimeHub {
  private readonly byDevice = new Map<string, Set<Connection>>();

  add(connection: Connection): () => void {
    const set = this.byDevice.get(connection.deviceId) ?? new Set<Connection>();
    set.add(connection);
    this.byDevice.set(connection.deviceId, set);

    return () => {
      set.delete(connection);
      if (set.size === 0) this.byDevice.delete(connection.deviceId);
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
        connection.socket.send(message);
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
          connection.socket.send(message);
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
}
