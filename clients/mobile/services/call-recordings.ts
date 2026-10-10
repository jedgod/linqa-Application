/**
 * Call recordings kept on this phone: the audio of this person's own side, and the transcript of both sides (this phone's own
 * speech recognised on the device, the other phone's lines received over the call's encrypted data channel). Nothing here is
 * uploaded. Files live in the app's private storage and are removed with the app.
 */

export interface TranscriptLine {
  who: "me" | "peer";
  /** Milliseconds from the start of the recording. */
  atMs: number;
  text: string;
}

export interface CallRecording {
  id: string;
  callId: string | null;
  peerName: string;
  callType: "AUDIO" | "VIDEO";
  startedAt: number;
  durationMs: number;
  audioUri: string;
  lines: TranscriptLine[];
}

const FOLDER = "linqa-recordings";
const INDEX = "index.json";

async function parts() {
  const { Directory, File, Paths } = await import("expo-file-system");
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return { dir, File, index: new File(dir, INDEX) };
}

/** Where a new recording's WAV file goes. */
export async function newRecordingUri(id: string): Promise<string> {
  const { dir, File } = await parts();
  return new File(dir, `${id}.wav`).uri;
}

export async function loadRecordings(): Promise<CallRecording[]> {
  try {
    const { index } = await parts();
    if (!index.exists) return [];
    const parsed = JSON.parse(await index.text()) as CallRecording[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.startedAt - a.startedAt) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: CallRecording[]): Promise<void> {
  const { index } = await parts();
  if (!index.exists) index.create();
  index.write(JSON.stringify(items));
}

export async function saveRecording(recording: CallRecording): Promise<void> {
  const all = await loadRecordings();
  await writeAll([recording, ...all.filter((r) => r.id !== recording.id)]);
}

export async function deleteRecording(id: string): Promise<void> {
  const all = await loadRecordings();
  const target = all.find((r) => r.id === id);
  if (target) {
    try {
      const { File } = await import("expo-file-system");
      const audio = new File(target.audioUri);
      if (audio.exists) audio.delete();
    } catch { /* the entry is removed even if the audio is already gone */ }
  }
  await writeAll(all.filter((r) => r.id !== id));
}

/** Both sides' lines in the order they were spoken. */
export function mergedLines(lines: TranscriptLine[]): TranscriptLine[] {
  return [...lines].sort((a, b) => a.atMs - b.atMs);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
