export class ProductionCallController {
  private peer: RTCPeerConnection | null = null;

  async start(input: {
    privacyMode: "STANDARD" | "RELAY_ONLY";
    turn: { urls: string[]; username: string; credential: string };
  }) {
    this.close();
    this.peer = new RTCPeerConnection({
      iceServers: [{
        urls: input.turn.urls,
        username: input.turn.username,
        credential: input.turn.credential
      }],
      iceTransportPolicy: input.privacyMode === "RELAY_ONLY" ? "relay" : "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require"
    });

    this.peer.oniceconnectionstatechange = () => {
      if (
        this.peer?.iceConnectionState === "failed" ||
        this.peer?.iceConnectionState === "disconnected"
      ) {
        this.restartIce();
      }
    };
    return this.peer;
  }

  restartIce() {
    if (!this.peer) throw new Error("Peer connection unavailable.");
    this.peer.restartIce();
  }

  close() {
    this.peer?.close();
    this.peer = null;
  }
}