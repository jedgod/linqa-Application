import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export const KINDS = [
  "photos",
  "document",
  "location",
  "contact",
  "poll",
  "event",
  "meeting",
  "voice",
  "video",
  "screen_share",
  "ai_image",
] as const;

export class SendAttachmentDto {
  @IsIn(KINDS)
  kind: (typeof KINDS)[number];

  @IsString()
  sealedPayload: string;

  @IsOptional()
  @IsIn(["ai_prompt"])
  cleartextException?: "ai_prompt";

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PollBody)
  poll?: PollBody;

  @IsOptional()
  @ValidateNested()
  @Type(() => EventBody)
  event?: EventBody;

  @IsOptional()
  @ValidateNested()
  @Type(() => MeetingBody)
  meeting?: MeetingBody;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationBody)
  location?: LocationBody;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContactBody)
  contact?: ContactBody;

  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentBody)
  document?: DocumentBody;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScreenBody)
  screenShare?: ScreenBody;

  @IsOptional()
  @IsArray()
  media?: MediaRef[];
}

export class PollBody {
  @IsString()
  question: string;

  @IsArray()
  options: string[];

  @IsBoolean()
  allowMultiple: boolean;

  @IsBoolean()
  hideVoters: boolean;

  @IsIn(["1h", "1d", "never"])
  closeVoting: "1h" | "1d" | "never";
}

export class EventBody {
  @IsString()
  title: string;

  @IsString()
  dateLabel: string;

  @IsString()
  start: string;

  @IsString()
  end: string;

  @IsOptional()
  @IsString()
  place?: string;
}

export class MeetingBody {
  @IsString()
  title: string;

  @IsString()
  dateLabel: string;

  @IsString()
  starts: string;

  @IsInt()
  @IsIn([15, 30, 45, 60])
  lengthMin: 15 | 30 | 45 | 60;

  @IsOptional()
  @IsString()
  note?: string;

  @IsBoolean()
  remind: boolean;
}

export class LocationBody {
  @IsString()
  label: string;

  @IsString()
  address: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}

export class ContactBody {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsString()
  initials: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  handle?: string;
}

export class DocumentBody {
  @IsString()
  name: string;

  @IsString()
  mime: string;

  @IsOptional()
  @IsInt()
  pageCount?: number;
}

export class ScreenBody {
  @IsString()
  presenterName: string;

  @IsOptional()
  @IsString()
  sharedTitle?: string;
}

export class MediaRef {
  @IsString()
  storageKey: string;

  @IsString()
  mime: string;

  @IsInt()
  byteLength: number;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsInt()
  durationSec?: number;

  waveform?: number[];
}

export class VoteDto {
  @IsArray()
  picks: number[];
}

export class RsvpDto {
  @IsIn(["going", "maybe", "cant"])
  value: "going" | "maybe" | "cant";
}

export class MeetingRespondDto {
  @IsIn(["accepted", "suggested", "declined"])
  value: "accepted" | "suggested" | "declined";

  @IsOptional()
  @IsString()
  suggestedIso?: string;
}

export class AiGenerateDto {
  @IsString()
  prompt: string;

  @IsIn(["photo", "watercolor", "sketch", "diagram"])
  style: "photo" | "watercolor" | "sketch" | "diagram";
}

export class SignalDto {
  @IsString()
  type: "offer" | "answer" | "ice" | "cursor";

  payload: unknown;
}
