import { Module } from "@nestjs/common";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsGateway } from "./attachments.gateway";
import { AttachmentsService } from "./attachments.service";
import { AiImageClient, MediaStore, PrismaService } from "./media.store";

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentsGateway, PrismaService, MediaStore, AiImageClient],
  exports: [AttachmentsService, AttachmentsGateway],
})
export class AttachmentsModule {}
