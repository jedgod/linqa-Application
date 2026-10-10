export type BiometricNative = {
  isAvailable():Promise<{available:boolean;strong:boolean;type:'FACE'|'FINGERPRINT'|'OTHER'|'NONE'}>;
  createSigningKey(alias:string):Promise<{publicKeySpkiBase64:string}>;
  sign(alias:string,payloadBase64:string,prompt:string):Promise<{signatureBase64:string}>;
  deleteKey(alias:string):Promise<void>;
};

export function buildSigningPayload(c:{
  challengeId:string;challenge:string;purpose:string;resourceHashHex:string;
  userId:string;deviceId:string;
}){
  return btoa([
    'LINQA-BIOMETRIC-V1',c.challengeId,c.challenge,c.purpose,c.resourceHashHex,c.userId,c.deviceId
  ].join('\n'));
}

export async function performBiometricStepUp(input:{
  apiBase:string;
  native:BiometricNative;
  keyAlias:string;
  purpose:string;
  resource:unknown;
  userId:string;
  deviceId:string;
  accessToken:string;
}){
  const headers={Authorization:`Bearer ${input.accessToken}`,'Content-Type':'application/json'};
  const cr=await fetch(`${input.apiBase}/v1/security/biometrics/challenges`,{
    method:'POST',headers,body:JSON.stringify({purpose:input.purpose,resource:input.resource})
  });
  if(!cr.ok) throw new Error('CHALLENGE_FAILED');
  const c=await cr.json();
  const payloadBase64=buildSigningPayload({...c,userId:input.userId,deviceId:input.deviceId});
  const signed=await input.native.sign(input.keyAlias,payloadBase64,'Confirm with biometrics');
  const vr=await fetch(`${input.apiBase}/v1/security/biometrics/verify`,{
    method:'POST',headers,body:JSON.stringify({
      challengeId:c.challengeId,challenge:c.challenge,signatureBase64:signed.signatureBase64
    })
  });
  if(!vr.ok) throw new Error('BIOMETRIC_VERIFICATION_FAILED');
  return vr.json() as Promise<{grantId:string;expiresAt:string}>;
}
