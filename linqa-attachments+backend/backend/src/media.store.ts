import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

@Injectable()
export class MediaStore {
  constructor(private readonly root = process.env.LINQA_MEDIA_DIR || "/var/lib/linqa/media") {}

  async put(threadId: string, senderId: string, bytes: Buffer, mime: string) {
    const storageKey = `${threadId}/${senderId}/${randomUUID()}`;
    const path = join(this.root, storageKey);
    await mkdir(join(this.root, threadId, senderId), { recursive: true });
    await writeFile(path, bytes);
    return { storageKey, mime, byteLength: bytes.length };
  }

  async get(storageKey: string) {
    const bytes = await readFile(join(this.root, storageKey));
    return { storageKey, bytes };
  }
}

@Injectable()
export class AiImageClient {
  async generate(prompt: string, style: string) {
    const endpoint = process.env.LINQA_IMAGE_SERVICE_URL;
    if (!endpoint) {
      return {
        previews: [0, 1, 2, 3].map((index) => ({
          mime: "image/png",
          storageKey: `ai-preview/${style}/${index}`,
          promptReceived: true,
        })),
      };
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LINQA_IMAGE_SERVICE_KEY}` },
      body: JSON.stringify({ prompt, style, count: 4 }),
    });
    if (!response.ok) throw new Error(`Image service ${response.status}`);
    return response.json() as Promise<{ previews: Array<{ mime: string; storageKey: string }> }>;
  }
}

@Injectable()
export class PrismaService {
  thread: any;
  attachment: any;
  poll: any;
  pollVote: any;
  event: any;
  rsvp: any;
  meeting: any;
  meetingResponse: any;
  mediaObject: any;
  screenShare: any;

  constructor() {
    const { PrismaClient } = require("@prisma/client");
    const client = new PrismaClient();
    Object.assign(this, client);
  }
}
