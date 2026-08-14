export class ScreenShareController {
  private stream:MediaStream|null=null;

  async start():Promise<MediaStream> {
    if (this.stream) throw new Error("Screen sharing already active.");

    this.stream=await navigator.mediaDevices.getDisplayMedia({
      video:{frameRate:{ideal:30,max:60}},
      audio:true
    });

    for (const track of this.stream.getTracks()) {
      track.addEventListener("ended",()=>this.stop(),{once:true});
    }
    return this.stream;
  }

  async replaceVideoTrack(peer:RTCPeerConnection) {
    if (!this.stream) throw new Error("Screen sharing is not active.");
    const track=this.stream.getVideoTracks()[0];
    if (!track) throw new Error("Screen video track missing.");

    const sender=peer.getSenders().find(item=>item.track?.kind==="video");
    if (!sender) throw new Error("Video sender missing.");
    await sender.replaceTrack(track);
  }

  stop() {
    for (const track of this.stream?.getTracks()??[]) track.stop();
    this.stream=null;
  }
}
