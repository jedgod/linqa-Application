import {createRemoteJWKSet,jwtVerify} from 'jose';
const issuer=process.env.JWT_ISSUER;
const audience=process.env.JWT_AUDIENCE;
const jwksUrl=process.env.JWT_JWKS_URL;
if(!issuer||!audience||!jwksUrl) throw new Error('JWT_ISSUER, JWT_AUDIENCE and JWT_JWKS_URL required');
const jwks=createRemoteJWKSet(new URL(jwksUrl));
export async function requireAuth(req,res,next){
 try{
  const token=/^Bearer (.+)$/i.exec(req.headers.authorization||'')?.[1];
  if(!token) return res.status(401).json({error:'missing_token'});
  const {payload}=await jwtVerify(token,jwks,{issuer,audience,algorithms:['RS256','ES256']});
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(payload.sub))) return res.status(401).json({error:'invalid_subject'});
  req.userId=String(payload.sub);next();
 }catch{res.status(401).json({error:'invalid_token'});}
}
