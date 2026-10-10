import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { AttachmentsService } from "./attachments.service";
import type { SignalDto } from "./dto";

@WebSocketGateway({ namespace: "/linqa", cors: { origin: true, credentials: true } })
export class AttachmentsGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly attachments: AttachmentsService) {}

  @SubscribeMessage("thread.join")
  join(@ConnectedSocket() socket: Socket, @MessageBody() body: { threadId: string }) {
    socket.join(body.threadId);
    return { ok: true };
  }

  @SubscribeMessage("screen.share")
  share(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { threadId: string; sessionId: string; sharedTitle?: string },
  ) {
    socket.join(`share:${body.sessionId}`);
    this.server.to(body.threadId).emit("screen.live", {
      sessionId: body.sessionId,
      presenterId: socket.data.userId,
      sharedTitle: body.sharedTitle,
      live: true,
    });
    return { ok: true };
  }

  @SubscribeMessage("screen.signal")
  signal(@MessageBody() body: SignalDto & { sessionId: string; to?: string }) {
    this.server.to(`share:${body.sessionId}`).emit("screen.signal", body);
    return { ok: true };
  }

  @SubscribeMessage("screen.end")
  async end(@ConnectedSocket() socket: Socket, @MessageBody() body: { threadId: string; sessionId: string }) {
    await this.attachments.endShare(body.sessionId, socket.data.userId);
    this.server.to(body.threadId).emit("screen.ended", { sessionId: body.sessionId });
    return { ok: true };
  }

  emitAttachment(threadId: string, card: unknown) {
    this.server.to(threadId).emit("attachment.created", card);
  }

  emitCardUpdate(threadId: string, card: unknown) {
    this.server.to(threadId).emit("attachment.updated", card);
  }
}
