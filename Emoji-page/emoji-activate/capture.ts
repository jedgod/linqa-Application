import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Audio } from "expo-av";
import { enqueue } from "./outbox";
import type { AttachmentKind, LocalFile, OutboxRow } from "./types";

type Ctx = { conversationId: string; senderId: string };

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function fileOf(uri: string, name: string, mime: string, extra: Partial<LocalFile> = {}): Promise<LocalFile> {
  const info = await FileSystem.getInfoAsync(uri);
  return { uri, name, mime, byteSize: info.exists ? info.size ?? 0 : 0, ...extra };
}

async function queue(ctx: Ctx, kind: AttachmentKind, file: LocalFile | null, body: string | null, payload: object) {
  const row: OutboxRow = {
    clientId: id(),
    conversationId: ctx.conversationId,
    senderId: ctx.senderId,
    kind,
    body,
    fileUri: file?.uri ?? null,
    mime: file?.mime ?? null,
    byteSize: file?.byteSize ?? null,
    width: file?.width ?? null,
    height: file?.height ?? null,
    durationMs: file?.durationMs ?? null,
    payload: JSON.stringify(payload),
    status: "pending",
    error: null,
    createdAt: Date.now(),
  };
  await enqueue(row);
  return row.clientId;
}

export async function addPhoto(ctx: Ctx) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Photo library permission denied");
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  const file = await fileOf(asset.uri, asset.fileName ?? "photo.jpg", asset.mimeType ?? "image/jpeg", {
    width: asset.width,
    height: asset.height,
  });
  return queue(ctx, "photo", file, null, {});
}

export async function addVideo(ctx: Ctx) {
  const camera = await ImagePicker.requestCameraPermissionsAsync();
  if (!camera.granted) throw new Error("Camera permission denied");
  const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ["videos"], videoMaxDuration: 60 });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  const file = await fileOf(asset.uri, asset.fileName ?? "video.mp4", asset.mimeType ?? "video/mp4", {
    width: asset.width,
    height: asset.height,
    durationMs: asset.duration ?? undefined,
  });
  return queue(ctx, "video", file, null, {});
}

export async function addVoice(ctx: Ctx, recording: Audio.Recording) {
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();
  if (!uri) throw new Error("Voice recording missing");
  const status = await recording.getStatusAsync();
  const file = await fileOf(uri, "voice.m4a", "audio/m4a", {
    durationMs: "durationMillis" in status ? status.durationMillis : undefined,
  });
  return queue(ctx, "voice", file, null, {});
}

export async function startVoice() {
  const permission = await Audio.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Microphone permission denied");
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();
  return recording;
}

export async function addDocument(ctx: Ctx) {
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  const file = await fileOf(asset.uri, asset.name, asset.mimeType ?? "application/octet-stream");
  return queue(ctx, "document", file, asset.name, {});
}

export async function addCroppedPhoto(ctx: Ctx) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Photo library permission denied");
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  const cropped = await manipulateAsync(asset.uri, [{ resize: { width: 1080 } }], { compress: 0.85, format: SaveFormat.JPEG });
  const file = await fileOf(cropped.uri, "design.jpg", "image/jpeg", { width: cropped.width, height: cropped.height });
  return queue(ctx, "design", file, null, { crop: "square" });
}

export async function addAiImage(ctx: Ctx, prompt: string, request: (prompt: string) => Promise<LocalFile>) {
  const clean = prompt.trim();
  if (!clean) throw new Error("Describe the image");
  const file = await request(clean);
  return queue(ctx, "ai_image", file, clean, { prompt: clean });
}

export async function addLocation(ctx: Ctx) {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("Location permission denied");
  const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const payload = {
    latitude: current.coords.latitude,
    longitude: current.coords.longitude,
    accuracyM: current.coords.accuracy,
    label: "Shared location",
  };
  return queue(ctx, "location", null, payload.label, payload);
}

export async function addPoll(ctx: Ctx, question: string, options: string[], multiple = false) {
  const labels = options.map((item) => item.trim()).filter(Boolean);
  if (!question.trim() || labels.length < 2) throw new Error("A poll needs a question and two options");
  return queue(ctx, "poll", null, question.trim(), { question: question.trim(), options: labels, multiple });
}

export async function addEvent(ctx: Ctx, input: { title: string; startsAt: string; endsAt?: string; place?: string; latitude?: number; longitude?: number }) {
  if (!input.title.trim() || !input.startsAt) throw new Error("Event needs a title and start time");
  return queue(ctx, "event", null, input.title.trim(), input);
}

export async function addMeeting(ctx: Ctx, input: { title: string; startsAt: string; endsAt: string }) {
  if (!input.title.trim() || !input.startsAt || !input.endsAt) throw new Error("Meeting needs a title and a time range");
  return queue(ctx, "meeting", null, input.title.trim(), { ...input, joinPath: `/meet/${id()}` });
}
