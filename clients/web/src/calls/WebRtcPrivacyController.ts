export type CallPrivacyMode = "STANDARD" | "RELAY_ONLY";

export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: string;
}

export class WebRtcPrivacyController {
  constructor(
    private readonly fetchTurnCredentials: () => Promise<TurnCredentials>
  ) {}

  async createPeerConnection(mode: CallPrivacyMode): Promise<RTCPeerConnection> {
    const turn = await this.fetchTurnCredentials();

    const configuration: RTCConfiguration = {
      iceServers: [
        {
          urls: turn.urls,
          username: turn.username,
          credential: turn.credential
        }
      ],
      iceTransportPolicy: mode === "RELAY_ONLY" ? "relay" : "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require"
    };

    return new RTCPeerConnection(configuration);
  }

  sanitizeCandidate(candidate: RTCIceCandidateInit): RTCIceCandidateInit {
    return {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment
    };
  }
}
