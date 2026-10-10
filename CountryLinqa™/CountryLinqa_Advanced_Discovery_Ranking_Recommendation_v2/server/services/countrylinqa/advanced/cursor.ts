import crypto from "node:crypto";

const secret=process.env.COUNTRYLINQA_CURSOR_SECRET;
if (!secret) throw new Error("COUNTRYLINQA_CURSOR_SECRET_REQUIRED");

export type CursorPayload={
  lastScore:number;
  lastUserId:string;
  policyVersion:number;
  issuedAt:number;
};

export function encodeCursor(p:CursorPayload) {
  const body=Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig=crypto.createHmac("sha256",secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function decodeCursor(token:string):CursorPayload {
  const [body,sig]=token.split(".");
  if (!body || !sig) throw Object.assign(new Error("INVALID_CURSOR"),{status:400});
  const expected=crypto.createHmac("sha256",secret).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))
    throw Object.assign(new Error("INVALID_CURSOR"),{status:400});
  const p=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
  if (Date.now()-p.issuedAt>15*60*1000)
    throw Object.assign(new Error("CURSOR_EXPIRED"),{status:400});
  return p;
}
