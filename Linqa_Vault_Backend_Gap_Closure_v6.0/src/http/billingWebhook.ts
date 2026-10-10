import type {Request,Response,NextFunction} from 'express';
// Mount this route BEFORE express.json(), using express.raw({type:'application/json'}), so provider signatures cover exact bytes.
export const billingWebhook=(billing:any)=>(req:Request,res:Response,next:NextFunction)=>Promise.resolve(billing.webhook(req.body as Buffer,String(req.headers['x-provider-signature']||''))).then(x=>res.json(x)).catch(next);
