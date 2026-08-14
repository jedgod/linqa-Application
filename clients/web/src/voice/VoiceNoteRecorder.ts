export class VoiceNoteRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  async start(): Promise<void> {
    if (this.recorder) throw new Error("Recording already active.");

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    this.chunks = [];
    this.startedAt = Date.now();
    this.recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : ""
    });

    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    this.recorder.start(1000);
  }

  async stop(): Promise<{ blob: Blob; durationMs: number }> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("No recording is active.");

    const result = await new Promise<{ blob: Blob; durationMs: number }>(
      (resolve, reject) => {
        recorder.onerror = () => reject(new Error("Voice recording failed."));
        recorder.onstop = () => {
          const durationMs = Date.now() - this.startedAt;
          const blob = new Blob(this.chunks, {
            type: recorder.mimeType || "audio/webm"
          });
          resolve({ blob, durationMs });
        };
        recorder.stop();
      }
    );

    for (const track of recorder.stream.getTracks()) track.stop();
    this.recorder = null;
    this.chunks = [];

    if (result.durationMs > 600_000) {
      throw new Error("Voice note exceeds the 10-minute limit.");
    }

    return result;
  }
}
