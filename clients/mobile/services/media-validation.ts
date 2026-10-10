export function assertMediaSignature(bytes: Uint8Array, mime: string) {
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  const iso = text(4, 4) === "ftyp";
  const valid = mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === "image/png" ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
    : mime === "image/gif" ? ["GIF87a", "GIF89a"].includes(text(0, 6))
    : mime === "image/webp" ? text(0, 4) === "RIFF" && text(8, 4) === "WEBP"
    : mime === "video/mp4" || mime === "video/quicktime" || mime === "audio/mp4" || mime === "audio/x-m4a" ? iso
    : mime === "audio/aac" ? bytes[0] === 255 && (bytes[1]! & 246) === 240
    : mime === "audio/mpeg" ? text(0, 3) === "ID3" || bytes[0] === 255 && (bytes[1]! & 224) === 224 : false;
  if (!valid) throw new Error("Select a supported photo, audio or video file. Its format does not match its file type.");
}
export async function actualVideoDuration(uri: string): Promise<number> {
  const { createVideoPlayer } = await import("expo-video");
  const player = createVideoPlayer(uri);
  let subscription: { remove(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const inspect = (status: string) => { if (status === "readyToPlay") resolve(); else if (status === "error") reject(new Error("Select a video that can be opened on this device.")); };
      subscription = player.addListener("statusChange", event => inspect(event.status));
      timer = setTimeout(() => reject(new Error("Select a video that can be opened on this device.")), 10_000);
      inspect(player.status);
    });
    const duration = player.duration * 1000;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60_000) throw new Error("Choose a video of 60 seconds or less.");
    return duration;
  } finally { if (timer) clearTimeout(timer); subscription?.remove(); player.release(); }
}
