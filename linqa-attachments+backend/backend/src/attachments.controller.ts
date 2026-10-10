import { Body, Controller, Get, Param, Post, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AttachmentsService } from "./attachments.service";
import { AiGenerateDto, MeetingRespondDto, RsvpDto, SendAttachmentDto, VoteDto } from "./dto";

@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post("threads/:threadId/attachments")
  send(@Param("threadId") threadId: string, @Body() dto: SendAttachmentDto, @Req() req: any) {
    return this.attachments.send(threadId, req.user.id, dto);
  }

  @Get("threads/:threadId/attachments")
  list(@Param("threadId") threadId: string, @Req() req: any) {
    return this.attachments.list(threadId, req.user.id);
  }

  @Post("attachments/:id/poll/vote")
  vote(@Param("id") id: string, @Body() dto: VoteDto, @Req() req: any) {
    return this.attachments.vote(id, req.user.id, dto);
  }

  @Post("attachments/:id/rsvp")
  rsvp(@Param("id") id: string, @Body() dto: RsvpDto, @Req() req: any) {
    return this.attachments.rsvp(id, req.user.id, dto);
  }

  @Post("attachments/:id/meeting/respond")
  respond(@Param("id") id: string, @Body() dto: MeetingRespondDto, @Req() req: any) {
    return this.attachments.respondMeeting(id, req.user.id, dto);
  }

  @Post("threads/:threadId/media")
  @UseInterceptors(FileInterceptor("file"))
  upload(@Param("threadId") threadId: string, @UploadedFile() file: any, @Req() req: any) {
    return this.attachments.uploadMedia(threadId, req.user.id, {
      mime: file.mimetype,
      bytes: file.buffer,
    });
  }

  @Get("media/:storageKey")
  download(@Param("storageKey") storageKey: string, @Req() req: any) {
    return this.attachments.downloadMedia(storageKey, req.user.id);
  }

  @Post("ai-images/generate")
  generate(@Body() dto: AiGenerateDto) {
    return this.attachments.generateImage(dto);
  }

  @Post("screen-share/:sessionId/end")
  end(@Param("sessionId") sessionId: string, @Req() req: any) {
    return this.attachments.endShare(sessionId, req.user.id);
  }
}
