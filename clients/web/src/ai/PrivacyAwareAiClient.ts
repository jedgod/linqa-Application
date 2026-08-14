export type AiPrivacyMode="ON_DEVICE"|"CONFIDENTIAL_CLOUD"|"DISABLED";

export interface OnDeviceAi {
  summarize(text:string):Promise<string>;
  translate(text:string,targetLanguage:string):Promise<string>;
}

export class PrivacyAwareAiClient {
  constructor(
    private readonly apiBaseUrl:string,
    private readonly getAccessToken:()=>Promise<string>,
    private readonly onDevice?:OnDeviceAi
  ) {}

  async summarize(input:{
    text:string;
    mode:AiPrivacyMode;
    encryptForCloud?:(text:string)=>Promise<Uint8Array>;
  }) {
    if (input.mode==="DISABLED") throw new Error("AI disabled.");

    if (input.mode==="ON_DEVICE") {
      if (!this.onDevice) throw new Error("On-device AI unavailable.");
      return this.onDevice.summarize(input.text);
    }

    if (!input.encryptForCloud) throw new Error("Cloud encryption required.");
    const encrypted=await input.encryptForCloud(input.text);
    const token=await this.getAccessToken();

    const response=await fetch(`${this.apiBaseUrl}/v1/ai/jobs`,{
      method:"POST",
      headers:{
        "content-type":"application/json",
        authorization:`Bearer ${token}`
      },
      body:JSON.stringify({
        jobType:"SUMMARY",
        privacyMode:"CONFIDENTIAL_CLOUD",
        inputCiphertextBase64:this.toBase64(encrypted)
      })
    });

    if (!response.ok) throw new Error("AI job failed.");
    return response.json();
  }

  private toBase64(bytes:Uint8Array) {
    let binary="";
    for (const byte of bytes) binary+=String.fromCharCode(byte);
    return btoa(binary);
  }
}
