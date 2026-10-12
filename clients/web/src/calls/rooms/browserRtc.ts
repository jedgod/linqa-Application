export const streams = new Map<string, globalThis.MediaStream>();
const NativeMediaStream=globalThis.MediaStream??(class {constructor(){throw Error('This browser does not support media calls.');}} as unknown as typeof globalThis.MediaStream);
export class MediaStream extends NativeMediaStream {
  toURL():string {streams.set(this.id,this);return this.id;}
}
export type MediaStreamTrack = globalThis.MediaStreamTrack;
export const RTCPeerConnection=globalThis.RTCPeerConnection;
export type RTCPeerConnection=globalThis.RTCPeerConnection;
export const RTCIceCandidate=globalThis.RTCIceCandidate;
export type RTCIceCandidate=globalThis.RTCIceCandidate;
export const RTCSessionDescription=globalThis.RTCSessionDescription;
export const mediaDevices={
  async getUserMedia(constraints:MediaStreamConstraints){const s=await navigator.mediaDevices.getUserMedia(constraints);return new MediaStream(s.getTracks());},
  async getDisplayMedia(_constraints:DisplayMediaStreamOptions){const s=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});return new MediaStream(s.getTracks());}
};
