import type { WebSocket } from "ws";

interface Connection {
  socket: WebSocket;
  userId: string;
  deviceId: string;
}

export class RealtimeHub {
  private readonly connections = new Map<string, Set<Connection>>();

  add(connection: Connection): () => void {
    const set = this.connections.get(connection.deviceId) ?? new Set<Connection>();
    set.add(connection);
    this.connections.set(connection.deviceId, set);

    return () => {
      set.delete(connection);
      if (set.size === 0) this.connections.delete(connection.deviceId);
    };
  }

  notify(deviceId: string, serverSequence: number) {
    const set = this.connections.get(deviceId);
    if (!set) return;

    const payload = JSON.stringify({
      type: "envelope.available",
      serverSequence
    });

    for (const connection of set) {
      if (connection.socket.readyState === connection.socket.OPEN) {
        connection.socket.send(payload);
      }
    }
  }
}
